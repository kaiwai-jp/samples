onmessage = (e) => {
  console.log('Worker: Message received from main script', e.data);
  //postMessage(workerResult);
} 
//self.importScripts('/src/wasm/webrtc/webrtc.js');

let audioDeviceModule;
let audioSendStream;
(async () => {
  const response = await fetch('/src/wasm/webrtc/webrtc.wasm');
  const buffer = await response.arrayBuffer();
  const instance = await WebAssembly.instantiate(buffer, {
    imports: {},
    env: {},
  });
  console.log(instance);

  /*
  const Transport = Module.Transport.extend("Transport", {
    __construct: function () {
      this.__parent.__construct.call(this);
    },
    __destruct: function () {
      this.__parent.__destruct.call(this);
    },
  });
  audioDeviceModule = Module.createAudioDeviceModule();
  audioDeviceModule.startPlayout();
  call = new Module.Call(new Transport(), audioDeviceModule);
  audioSendStream = call.createAudioSendStream({
    ssrc: 123,
    cname: 'cname',
    payloadType: 42,
    codecName: 'opus',
    clockrateHz: 48000,
    numChannels: 2,
  });
  audioSendStream.start();
  */
})();

class WebRTC {
  constructor(sendVideo, miniVideo, dc) {
    // TODO: Consider changing width & height.
    this.width = 640;
    this.height = 480;
    this.fps = 10;
    this.sendVideo = sendVideo;
    // $(UI_CONSTANTS.miniVideo) from appcontroller.js.
    this.miniVideo = miniVideo;
    //this._loadWasm('/src/wasm/webrtc/webrtc.js');
    this.dc = dc;
  }

  _loadWasm(src) {
    console.warn('loading wasm module:', src);
    const time = Date.now();
    const script = document.createElement('script');
    script.src = src;

    script.onerror = () => {
      console.warn('failed to load the script:', src);
    };

    script.onload = () => {
      console.log('script loaded, waiting for wasm...');

      Module.onRuntimeInitialized = () => {
        console.warn('webrtc.wasm loaded:', Date.now() - time, 'ms');
        console.log('wasm module:', Module);
        // this._showTheStartButton();
        this.start();
      };
    };

    document.body.appendChild(script);
  }

  start() {
    var call = undefined;
    const dc = this.dc;
    const Transport = Module.Transport.extend("Transport", {
      __construct: function () {
        this.__parent.__construct.call(this);

        console.warn('Subscribing to RTP packets');
        let last = Date.now();
        setInterval(() => {
          const now = Date.now();
          console.log('sent', this.count, Math.floor(1000 * this.count / (now - last)));
          this.count = 0;
          last = now;
        }, 1000);
        dc2.onmessage = event => {
          const time = Date.now();
          const packet = new Uint8Array(event.data);
          // uistats.rtpRecvSize.set(packet.length);
          // console.log('Received a RTP packet:', packet.length, 'bytes', packet);
          let receivedBuffer = new Module.VectorUint8();
          for (let i = 0; i < packet.length; i++) {
            receivedBuffer.push_back(packet[i]);
          }
          setTimeout(() => {
              call.deliverPacket(receivedBuffer);
          }, 0);
          // uistats.audioDecTime.set(Date.now() - time);
        };
      },
      __destruct: function () {
        this.__parent.__destruct.call(this);
      },
      sendPacket: function (payload) {
        // console.log(payload);
        //console.log('Sending a RTP packet:', payload.length, 'bytes', payload);
        // uistats.rtpSendSize.set(payload.length);
        // console.log('Sending a RTP packet:', payload.length, 'bytes');
        this.count++;
        const payloadCopy = new Uint8Array(payload);
        dc.send(payloadCopy);
        return true;
      },
    });
    let audioDeviceModule = Module.createAudioDeviceModule();
    audioDeviceModule.startPlayout();
    call = new Module.Call(new Transport(), audioDeviceModule);
    let audioSendStream = call.createAudioSendStream({
      ssrc: 123,
      cname: 'cname',
      payloadType: 42,
      codecName: 'opus',
      clockrateHz: 48000,
      numChannels: 2,
    });
    audioSendStream.start();

    let videoSendStream = call.createVideoSendStream({
      ssrc: 234,
    });
    videoSendStream.start();

    function intToFloat(intSample) {
      return intSample / 32768;
    }

    function floatToInt(floatSample) {
      const s = Math.max(-1, Math.min(1, floatSample));
      return s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    function startSendingVideo(width, height, fps, miniVideo) {
      console.log('Starting to send VideoFrames on wasm VideoSendStream...');
      const sendFrame = () => {
        const localCanvas = document.createElement('canvas');
        localCanvas.width = width;
        localCanvas.height = height;
        const localContext2d = localCanvas.getContext('2d');
        if (dc === undefined || dc.readyState != 'open')
          return;
        localContext2d.drawImage(miniVideo, 0, 0, width, height);
        const {data: rgba} = localContext2d.getImageData(0, 0, width, height);
        console.log('Sending raw video frame', rgba);

        const rgbaSize = width * height * 4;
        // const yuvSize = this.width * this.height * 3 / 2; // 48 bits per 4 pixels
        if (rgba.length != rgbaSize)
          console.warn('Wrong RGBA data size:', rgba.length);

        let videoData = new Module.VectorUint8();
        for (let i = 0; i < rgba; i++) {
          videoData.push_back(rgba[i]);
        }
        // TODO:Passing in 0 as a timestamp, could be causing the frames to get dropped.
        const videoFrame = new Module.VideoFrame(0, width, height);
        videoFrame.setRgbData(videoData);
        videoSendStream.sendVideoFrame(videoFrame);
        // delete videoFrame
      };

      if (fps > 0) {
        setInterval(sendFrame, 1000 / fps);
      } else {
        const button = document.createElement('button');
        button.setAttribute('style', 'position:fixed;left:10px;top:10px');
        button.textContent = 'Send Frame';
        document.body.append(button);
        button.addEventListener('click', () => sendFrame());
      }
      // TODO: Receiver w/ remote data.
    }

    function sendAudio(floatBufferChannel1, /*floatBufferChannel2, */sampleRate) {
      const numSamples = sampleRate / 100;
      const numChannels = 1;
      // buffer in
      for (let i = 0; i < floatBufferChannel1.length; i++) {
        sendingQueue.push(floatToInt(floatBufferChannel1[i]));
        // sendingQueue.push(floatToInt(floatBufferChannel2[i]));
      }

      // while we have something in the queue, send it right away! hopefully
      // webrtc is ok with that.
      while(sendingQueue.length > numChannels * numSamples) {
        let sendBuffer = new Module.VectorInt16();
        for (let i = 0; i < numChannels * numSamples; i++) {
          sendBuffer.push_back(sendingQueue[i]);
        }

        // console.log("sending packet, current_length=" + sendingQueue.length);
        sendingQueue.splice(0, numChannels * numSamples);

        const audioFrame = new Module.AudioFrame();
        audioFrame.setNumChannels(numChannels);
        audioFrame.setSampleRateHz(sampleRate);
        audioFrame.setSamplesPerChannel(sendBuffer.size() / numChannels);
        audioFrame.setData(sendBuffer);
        audioSendStream.sendAudioData(audioFrame);
        // best garbage collection I can think of
        sendBuffer.delete();
      }
    }

    let receiveAudioCodecs = new Module.VectorAudioCodec();
    receiveAudioCodecs.push_back({
      payloadType: 42,
      name: 'opus',
      clockrateHz: 48000,
      numChannels: 2,
    });
    let receiveStream = call.createAudioReceiveStream({
      localSsrc: 345,
      remoteSsrc: 123,
      codecs: receiveAudioCodecs,
    });

    receiveStream.start();

    var sendingQueue = [];
    var receivingQueueChannel1 = [];
    var receivingQueueChannel2 = [];
    function startSendingAudio(sendVideo) {
      console.warn('Activating webrtc audio');
      var audioCtx = new AudioContext();
      var source = audioCtx.createMediaStreamSource(localStream);
      // var processor = audioCtx.createScriptProcessor(framesPerPacket, 2, 2);
      var processor = audioCtx.createScriptProcessor(framesPerPacket, 1, 1);
      source.connect(processor).connect(audioCtx.destination);
      processor.onaudioprocess = function (e) {
        var channelData = e.inputBuffer.getChannelData(0);
        // could look at e.inputBuffer.numChannels
        // var channelData2 = e.inputBuffer.getChannelData(0); // (0) was wrong???
        // console.log('captured audio ' + channelData.length);
        // console.log(channelData);
        sendAudio(channelData, /*channelData2, */e.inputBuffer.sampleRate);
      }

      // And playback, hacky, using script processor
      var audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      destination = audioCtx.createMediaStreamDestination();
      document.querySelector("#remoteVideo").srcObject = destination.stream;
      var playbackProcessor = audioCtx.createScriptProcessor(receivingSamplesPerCallback, 2, 2);
      var oscillator = audioCtx.createOscillator();
      oscillator.type = 'square';
      oscillator.frequency.setValueAtTime(440, audioCtx.currentTime); // value in hertz
      oscillator.connect(playbackProcessor).connect(audioCtx.destination);
      let recvCount = 0;
      let lastRecv = Date.now();
      setInterval(() => {
        const now = Date.now();
        console.log('recv', recvCount, Math.floor(1000 * recvCount / (now - lastRecv)));
        recvCount = 0;
        lastRecv = now;
      }, 1000);
      playbackProcessor.onaudioprocess = function (e) {
        var outputBuffer = e.outputBuffer;
        var channel1 = outputBuffer.getChannelData(0);
        var channel2 = outputBuffer.getChannelData(1);
        let numberOfPulls = channel1.length / 441;
        var offset = 0;
        for(i=0; i < numberOfPulls; i++) {
          recvCount++;
          const audioFrame = new Module.AudioFrame();
          audioFrame.setNumChannels(2);
          audioFrame.setSampleRateHz(44100);
          audioFrame.setSamplesPerChannel(441);

          // pre-allocate!
          for (let i = 0; i < 441 * 2; i++) {
            audioFrame.data().push_back(0);
          }

          audioDeviceModule.pullRenderData(audioFrame);

          for(var s = 0; s < audioFrame.data().size() / 2; s++) {
            receivingQueueChannel1.push(intToFloat(audioFrame.data().get(s*2)));
            receivingQueueChannel2.push(intToFloat(audioFrame.data().get(s*2+1)));
          }
        }

        if(receivingQueueChannel1.length > receivingSamplesPerCallback) {
        for(var i=0; i < receivingSamplesPerCallback; i++) {
          channel1[i] = receivingQueueChannel1[i];
          channel2[i] = receivingQueueChannel2[i];
        }
        receivingQueueChannel1.splice(0, receivingSamplesPerCallback);
        receivingQueueChannel2.splice(0, receivingSamplesPerCallback);
        }
      }
      oscillator.start();
    };
    startSendingAudio();
    if (this.sendVideo) {
      startSendingVideo(this.width, this.height, this.fps, this.miniVideo);
    }
  };
}
