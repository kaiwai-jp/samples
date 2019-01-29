'use strict';
const localContext = localCanvas.getContext('2d');
const remoteContext = remoteCanvas.getContext('2d');

const src = '/src/wasm/libvpx/vpx-worker.js';

const vpxenc_ = new Worker(src);
const vpxdec_ = new Worker(src);

console.log([
  'Default VPX params:',
  '',
  '   ?codec=vp8    Can also use vp9.',
  '   ?width=640',
  '   ?height=480',
  '   ?vsbr=1500    Video bitrate in kilobits per second.',
  '   ?fps=30       fps=0 would allow to send frames one by one.',
  '   ?packet=16    The packet size in KB. Cannot exceed 64 KB.',
  '',
  'For example, to encode 720p video with VP9 use:',
  '',
  '   ?libvpx=1&codec=vp9&width=1280&height=720',
].join('\n'));

const vpxconfig_ = {};

vpxconfig_.codec = 'VP8';
vpxconfig_.width = 320;
vpxconfig_.height = 240;
vpxconfig_.fps = 30;
vpxconfig_.bitrate = 600;
vpxconfig_.packetSize = 16;

console.log('VPX config:', vpxconfig_);

vpxenc_.postMessage({ type: 'init', data: vpxconfig_ });
vpxdec_.postMessage({ type: 'init', data: vpxconfig_ });

navigator.mediaDevices.getUserMedia({video: {width: 320, height: 240}})
  .then(stream => {
    const pc1 = new RTCPeerConnection();
    const pc2 = new RTCPeerConnection();
    pc1.onicecandidate = e => pc2.addIceCandidate(e.candidate);
    pc2.onicecandidate = e => pc1.addIceCandidate(e.candidate);
    const sendChannel = pc1.createDataChannel('sendDataChannel');
    sendChannel.binaryType = 'arraybuffer';
    pc1.addTrack(stream.getTracks()[0], stream);
    let receiveChannel;
    const recvBuffer = [];
    let decbuf = new Uint8Array(1 << 20);
    let decbuflen = 0;
    pc2.ondatachannel = e => {
      receiveChannel = e.channel;
      receiveChannel.binaryType = 'arraybuffer';
      receiveChannel.onmessage = (ev) => {
        const data = new Uint8Array(ev.data);
        decbuf.set(data, decbuflen);
        decbuflen += data.length;
        if (data.length == 16384)
            return; // wait for the final chunk of the incoming frame

        const packets = decbuf.slice(0, decbuflen);
        decbuflen = 0;
        /*
        const drop = Math.random() < 0.1;
        if (drop) return; // 10% packet loss.
        */
        vpxdec_.postMessage({
          id: 'dec',
          type: 'call',
          name: 'decode',
          args: [packets.buffer],
        }, [packets.buffer]);
      };
    };
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


    localVideo.srcObject = stream;
    localVideo2.srcObject = stream;
    const width = 320;
    const height = 240;

    localCanvas.width = width;
    localCanvas.height = height;
    remoteCanvas.width = width;
    remoteCanvas.height = height;

    let bytesSent = 0;
    let frames = 0;
    let lastTime = Date.now();
    const fps = 30;
    let encoding = false;
    setTimeout(() => {
        setInterval(() => {
            if (encoding) return; // TODO: apprtc is a bit smarter here.
            encoding = true;
            localContext.drawImage(localVideo, 0, 0, width, height);
            const frame = localContext.getImageData(0, 0, width, height);
            vpxenc_.postMessage({
                id: 'enc',
                type: 'call',
                name: 'encode',
                args: [frame.data.buffer]
            }, [frame.data.buffer]);
        }, 1000.0 / fps);
    }, 1000); // wait a bit before grabbing frames to give the wasm stuff time to init.
    setInterval(() => {
        const now = Date.now();
        console.log('bitrate', Math.floor(8000.0 * bytesSent / (now - lastTime)),
            'fps', Math.floor(1000.0 * frames / (now - lastTime)));
        bytesSent = 0;
        frames = 0;
        lastTime = now;
    }, 1000);
    vpxenc_.onmessage = e => {
        encoding = false;
        if (e.data.res) {
            const encoded = new Uint8Array(e.data.res);
            for (let offset = 0; offset < encoded.length; offset += 16384) {
                const length = Math.min(16384, encoded.length - offset);
                const view = new Uint8Array(encoded.buffer, offset, length);
                sendChannel.send(view); // 64 KB max
            }
            bytesSent += encoded.length;
            frames++;
        }
    };
    vpxdec_.onmessage = e => {
        if (e.data.res) {
            const decoded = new Uint8Array(e.data.res);
            const frame = remoteContext.createImageData(320, 240);
            frame.data.set(decoded, 0);
            remoteContext.putImageData(frame, 0, 0);
        }
    };
});
