/*
 *  Copyright (c) 2015 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */

'use strict';

const startButton = document.getElementById('startButton');
const callButton = document.getElementById('callButton');
const hangupButton = document.getElementById('hangupButton');
callButton.disabled = true;
hangupButton.disabled = true;
startButton.addEventListener('click', start);
callButton.addEventListener('click', call);
hangupButton.addEventListener('click', hangup);

let startTime;
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');

localVideo.addEventListener('loadedmetadata', function() {
  console.log(`Local video videoWidth: ${this.videoWidth}px,  videoHeight: ${this.videoHeight}px`);
});

remoteVideo.addEventListener('loadedmetadata', function() {
  console.log(`Remote video videoWidth: ${this.videoWidth}px,  videoHeight: ${this.videoHeight}px`);
});

remoteVideo.addEventListener('resize', () => {
  console.log(`Remote video size changed to ${remoteVideo.videoWidth}x${remoteVideo.videoHeight}`);
  // We'll use the first onsize callback as an indication that video has started
  // playing out.
  if (startTime) {
    const elapsedTime = window.performance.now() - startTime;
    console.log('Setup time: ' + elapsedTime.toFixed(3) + 'ms');
    startTime = null;
  }
});

let localStream;
let pc1;
let pc2;
let dc;
let destination;
let senderwart;
const offerOptions = {
  offerToReceiveAudio: 0,
  offerToReceiveVideo: 0
};

const framesPerPacket = 512;
const receivingSamplesPerCallback = 2048;

class WebRTC {
  constructor(sendVideo, miniVideo, dc) {
    // TODO: Consider changing width & height.
    this.width = 640;
    this.height = 480;
    this.fps = 10;
    this.sendVideo = sendVideo;
    // $(UI_CONSTANTS.miniVideo) from appcontroller.js.
    this.miniVideo = miniVideo;
    this._loadWasm('/src/wasm/webrtc/webrtc.js');
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
        dc.onmessage = event => {
          const time = Date.now();
          const packet = new Uint8Array(event.data);
          // uistats.rtpRecvSize.set(packet.length);
          console.log('Received a RTP packet:', packet.length, 'bytes', packet);
          let receivedBuffer = new Module.VectorUint8();
          for (i = 0; i < packet.length; i++) {
            receivedBuffer.push_back(packet[i]);
          }
          call.deliverPacket(receivedBuffer);
          // uistats.audioDecTime.set(Date.now() - time);
          this.count = 0;
        };
      },
      __destruct: function () {
        this.__parent.__destruct.call(this);
      },
      sendPacket: function (payload) {
        // console.log(payload);
        // console.log('Sending a RTP packet:', payload.length, 'bytes', payload);
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

    function sendAudio(floatBufferChannel1, floatBufferChannel2) {
      // buffer in
      for (let i = 0; i < floatBufferChannel1.length; i++) {
        sendingQueue.push(floatToInt(floatBufferChannel1[i]));
        sendingQueue.push(floatToInt(floatBufferChannel2[i]));
      }

      // while we have something in the queue, send it right away! hopefully
      // webrtc is ok with that.
      let sendBuffer = new Module.VectorInt16();
      for (let i = 0; i < 2 * 480; i++) {
        sendBuffer.push_back(sendingQueue[i]);
      }

      while(sendingQueue.length > 2 * 480) {
        // console.log("sending packet, current_length=" + sendingQueue.length);
        sendingQueue.splice(0, 2 * 480);

        const audioFrame = new Module.AudioFrame();
        audioFrame.setNumChannels(2);
        audioFrame.setSampleRateHz(48000);
        audioFrame.setSamplesPerChannel(sendBuffer.size() / 2);
        audioFrame.setData(sendBuffer);
        audioSendStream.sendAudioData(audioFrame);
      }

      // best garbage collection I can think of
      sendBuffer.delete();
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
      var processor = audioCtx.createScriptProcessor(framesPerPacket, 2, 2);
      // var processor = stream.context.createScriptProcessor(0, 1, 1);
      source.connect(processor).connect(audioCtx.destination);
      processor.onaudioprocess = function (e) {
        var channelData = e.inputBuffer.getChannelData(0);
        var channelData2 = e.inputBuffer.getChannelData(0);
        // console.log('captured audio ' + channelData.length);
        // console.log(channelData);
        sendAudio(channelData, channelData2);
      }

      // And playback, hacky, using script processor
      var audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      destination = audioCtx.createMediaStreamDestination();
      var playbackProcessor = audioCtx.createScriptProcessor(receivingSamplesPerCallback, 2, 2);
      var oscillator = audioCtx.createOscillator();
      oscillator.type = 'square';
      oscillator.frequency.setValueAtTime(440, audioCtx.currentTime); // value in hertz
      oscillator.connect(playbackProcessor).connect(audioCtx.destination);
      playbackProcessor.onaudioprocess = function (e) {
        var outputBuffer = e.outputBuffer;
        var channel1 = outputBuffer.getChannelData(0);
        var channel2 = outputBuffer.getChannelData(1);
        let numberOfPulls = channel1.length / 480;
        var offset = 0;
        for(i=0; i < numberOfPulls; i++) {
          const audioFrame = new Module.AudioFrame();
          audioFrame.setNumChannels(2);
          audioFrame.setSampleRateHz(48000);
          audioFrame.setSamplesPerChannel(480);

          // pre-allocate!
          for (let i = 0; i < 480 * 2; i++) {
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

function getName(pc) {
  return (pc === pc1) ? 'pc1' : 'pc2';
}

function getOtherPc(pc) {
  return (pc === pc1) ? pc2 : pc1;
}

async function start() {
  console.log('Requesting local stream');
  startButton.disabled = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({audio: true, video: true});
    console.log('Received local stream');
    localVideo.srcObject = stream;
    localStream = stream;
    callButton.disabled = false;
  } catch (e) {
    alert(`getUserMedia() error: ${e.name}`);
  }
}

function getSelectedSdpSemantics() {
  const sdpSemanticsSelect = document.querySelector('#sdpSemantics');
  const option = sdpSemanticsSelect.options[sdpSemanticsSelect.selectedIndex];
  return option.value === '' ? {} : {sdpSemantics: option.value};
}

async function call() {
  callButton.disabled = true;
  hangupButton.disabled = false;
  console.log('Starting call');
  startTime = window.performance.now();
  const videoTracks = localStream.getVideoTracks();
  const audioTracks = localStream.getAudioTracks();
  if (videoTracks.length > 0) {
    console.log(`Using video device: ${videoTracks[0].label}`);
  }
  if (audioTracks.length > 0) {
    console.log(`Using audio device: ${audioTracks[0].label}`);
  }
  const configuration = getSelectedSdpSemantics();
  console.log('RTCPeerConnection configuration:', configuration);
  pc1 = new RTCPeerConnection(configuration);
  console.log('Created local peer connection object pc1');
  pc1.addEventListener('icecandidate', e => onIceCandidate(pc1, e));
  pc2 = new RTCPeerConnection(configuration);
  console.log('Created remote peer connection object pc2');
  pc2.addEventListener('icecandidate', e => onIceCandidate(pc2, e));
  pc1.addEventListener('iceconnectionstatechange', e => onIceStateChange(pc1, e));
  pc2.addEventListener('iceconnectionstatechange', e => onIceStateChange(pc2, e));
  pc2.addEventListener('track', gotRemoteStream);

  // localStream.getTracks().forEach(track => pc1.addTrack(track, localStream));
  // console.log('Added local stream to pc1');

  dc = pc1.createDataChannel('foo');
  try {
    console.log('pc1 createOffer start');
    const offer = await pc1.createOffer(offerOptions);
    await onCreateOfferSuccess(offer);
  } catch (e) {
    onCreateSessionDescriptionError(e);
  }
  senderwart = new WebRTC(false, document.querySelector("#localVideo"), dc);
}

function onCreateSessionDescriptionError(error) {
  console.log(`Failed to create session description: ${error.toString()}`);
}

async function onCreateOfferSuccess(desc) {
  console.log(`Offer from pc1\n${desc.sdp}`);
  console.log('pc1 setLocalDescription start');
  try {
    await pc1.setLocalDescription(desc);
    onSetLocalSuccess(pc1);
  } catch (e) {
    onSetSessionDescriptionError();
  }

  console.log('pc2 setRemoteDescription start');
  try {
    await pc2.setRemoteDescription(desc);
    onSetRemoteSuccess(pc2);
  } catch (e) {
    onSetSessionDescriptionError();
  }

  console.log('pc2 createAnswer start');
  // Since the 'remote' side has no media stream we need
  // to pass in the right constraints in order for it to
  // accept the incoming offer of audio and video.
  try {
    const answer = await pc2.createAnswer();
    await onCreateAnswerSuccess(answer);
  } catch (e) {
    onCreateSessionDescriptionError(e);
  }
}

function onSetLocalSuccess(pc) {
  console.log(`${getName(pc)} setLocalDescription complete`);
}

function onSetRemoteSuccess(pc) {
  console.log(`${getName(pc)} setRemoteDescription complete`);
}

function onSetSessionDescriptionError(error) {
  console.log(`Failed to set session description: ${error.toString()}`);
}

function gotRemoteStream(e) {
  if (remoteVideo.srcObject !== e.streams[0]) {
    remoteVideo.srcObject = e.streams[0];
    console.log('pc2 received remote stream');
  }
}

async function onCreateAnswerSuccess(desc) {
  console.log(`Answer from pc2:\n${desc.sdp}`);
  console.log('pc2 setLocalDescription start');
  try {
    await pc2.setLocalDescription(desc);
    onSetLocalSuccess(pc2);
  } catch (e) {
    onSetSessionDescriptionError(e);
  }
  console.log('pc1 setRemoteDescription start');
  try {
    await pc1.setRemoteDescription(desc);
    onSetRemoteSuccess(pc1);
  } catch (e) {
    onSetSessionDescriptionError(e);
  }
}

async function onIceCandidate(pc, event) {
  try {
    await (getOtherPc(pc).addIceCandidate(event.candidate));
    onAddIceCandidateSuccess(pc);
  } catch (e) {
    onAddIceCandidateError(pc, e);
  }
  console.log(`${getName(pc)} ICE candidate:\n${event.candidate ? event.candidate.candidate : '(null)'}`);
}

function onAddIceCandidateSuccess(pc) {
  console.log(`${getName(pc)} addIceCandidate success`);
}

function onAddIceCandidateError(pc, error) {
  console.log(`${getName(pc)} failed to add ICE Candidate: ${error.toString()}`);
}

function onIceStateChange(pc, event) {
  if (pc) {
    console.log(`${getName(pc)} ICE state: ${pc.iceConnectionState}`);
    console.log('ICE state change event: ', event);
  }
}

function hangup() {
  console.log('Ending call');
  pc1.close();
  pc2.close();
  pc1 = null;
  pc2 = null;
  hangupButton.disabled = true;
  callButton.disabled = false;
}
