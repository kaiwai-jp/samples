'use strict';
const localContext = localCanvas.getContext('2d');
const remoteContext = remoteCanvas.getContext('2d');

const pc1 = new RTCPeerConnection();
const pc2 = new RTCPeerConnection();
pc1.onicecandidate = e => pc2.addIceCandidate(e.candidate);
pc2.onicecandidate = e => pc1.addIceCandidate(e.candidate);
const sendChannel = pc1.createDataChannel('sendDataChannel');
let receiveChannel;
const recvBuffer = [];
pc2.ondatachannel = e => {
  receiveChannel = e.channel;
  receiveChannel.onmessage = (ev) => {
    const encoded = new Uint8Array(ev.data);
    const {data, width, height} = libwebp.decode(encoded);
    const frame = remoteContext.createImageData(width, height);
    frame.data.set(data, 0);
    remoteContext.putImageData(frame, 0, 0);
  };
};

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

const libwebp = new LibWebP();
navigator.mediaDevices.getUserMedia({video: {width: 320, height: 240}})
  .then(stream => {
    localVideo.srcObject = stream;
    const width = 320;
    const height = 240;

    localCanvas.width = width;
    localCanvas.height = height;
    remoteCanvas.width = width;
    remoteCanvas.height = height;

    let bytesSent = 0;
    let lastTime = Date.now();
    const fps = 15;
    setInterval(() => {
        localContext.drawImage(localVideo, 0, 0, width, height);
        const frame = localContext.getImageData(0, 0, width, height);
        const encoded = libwebp.encode(frame);
        sendChannel.send(encoded); // 320x240 fits a single 65k frame.
        bytesSent += encoded.length;
    }, 1000.0 / fps);
    setInterval(() => {
        const now = Date.now();
        console.log('bitrate', 8.0 * bytesSent / (now - lastTime));
        bytesSent = 0;
        lastTime = now;
    }, 1000);
});
