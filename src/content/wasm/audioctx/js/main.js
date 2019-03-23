'use strict';
const framesPerPacket = 2048;
const buffer = [];

const pc1 = new RTCPeerConnection();
const pc2 = new RTCPeerConnection();
pc1.onicecandidate = e => pc2.addIceCandidate(e.candidate);
pc2.onicecandidate = e => pc1.addIceCandidate(e.candidate);
let receiveChannel;
navigator.mediaDevices.getUserMedia({audio: true})
  .then(stream => {
    localVideo.srcObject = stream;

    const sendChannel = pc1.createDataChannel('sendDataChannel');
    sendChannel.binaryType = 'arraybuffer';
    let receiveChannel;
    const recvBuffer = [];
    pc2.ontrack = (e) => remoteVideo2.srcObject = e.streams[0];
    pc1.createOffer()
      .then(offer => {
        return pc2.setRemoteDescription(offer)
            .then(() => pc1.setLocalDescription(offer));
      })
      .then(() => pc2.createAnswer())
      .then(answer => {
        return pc1.setRemoteDescription(answer)
            .then(() => pc2.setLocalDescription(answer));
      })
      .catch(e => console.error(e));


    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    // var processor = audioCtx.createScriptProcessor(framesPerPacket, 2, 2);
    const processor = audioCtx.createScriptProcessor(framesPerPacket, 1, 1);
    source.connect(processor);
    processor.onaudioprocess = function (e) {
      if (sendChannel.readyState !== 'open') return;
      const channelData = e.inputBuffer.getChannelData(0);
      sendChannel.send(channelData);
    };

    // Receiving end.
    pc2.ondatachannel = e => {
      receiveChannel = e.channel;
      receiveChannel.binaryType = 'arraybuffer';
      receiveChannel.onmessage = (ev) => {
        const data = new Float32Array(ev.data);
        buffer.push(data);
        bytesReceived += ev.data.byteLength;
      };
    };

    // Playback, hacky, using script processor
    const destination = audioCtx.createMediaStreamDestination();
    document.querySelector("#remoteVideo").srcObject = destination.stream;
    const playbackProcessor = audioCtx.createScriptProcessor(framesPerPacket, 1, 1);
    const oscillator = audioCtx.createOscillator();
    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(440, audioCtx.currentTime); // value in hertz
    oscillator.connect(playbackProcessor).connect(audioCtx.destination);
    playbackProcessor.onaudioprocess = function (e) {
      const data = buffer.shift();
      if (!data) {
        return;
      }
      const outputBuffer = e.outputBuffer;
      const channel1 = outputBuffer.getChannelData(0);
      for(let i=0; i < framesPerPacket; i++) {
        channel1[i] = data[i];
      }
    };
    oscillator.start();

    // measure bitrate.
    let bytesReceived = 0;
    let lastTime = Date.now();
    setInterval(() => {
        const now = Date.now();
        console.log('bitrate', Math.floor(8000.0 * bytesReceived / (now - lastTime)));
        bytesReceived = 0;
        lastTime = now;
    }, 1000);
});
