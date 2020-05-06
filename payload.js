const IP = "192.168.90.120",
      DELAY_BETWEEN_PAYLOADS_MS = 3000,
      PAYLOAD_PORT = 9020,
      KERNEL_PAYLOAD_PORT = 9023,
      JKPATCH_FILE_NAME = './golden-jk-patch.bin',
      KERNEL_PAYLOAD_FILE_NAME = './kpayload-to-port-9023.elf';

const fs = require('fs');
const { Socket } = require('net');

(async function () {
  await initialize();
  await delay(DELAY_BETWEEN_PAYLOADS_MS);
  await loadJKPatchKPayload();
  await delay(DELAY_BETWEEN_PAYLOADS_MS);
  console.log('ready!');
  return 0;
})();

async function initialize() {
  return new Promise(resolve => {
    const jkPatch = fs.createReadStream(JKPATCH_FILE_NAME);
    let jkSock = new Socket();
    jkSock.setTimeout(3000);
    jkSock.setNoDelay(true);
    jkSock.on('end', () => resolve());
    jkSock.connect(PAYLOAD_PORT, IP, () => {
      console.log('main socket connect success! loading JKPatch');
      jkPatch.pipe(jkSock);
    });
  }).catch(() => console.log('error initializing'));
}

async function loadJKPatchKPayload() {
  const jkPayload = fs.createReadStream(KERNEL_PAYLOAD_FILE_NAME);
  return new Promise(resolve => {
    let kSock = new Socket();
    kSock.setTimeout(3000);
    kSock.setNoDelay(true);
    kSock.connect(KERNEL_PAYLOAD_PORT, IP, () => {
      console.log('kernel socket connect success! loading kernel payload');
      jkPayload.pipe(kSock);
      resolve();
    });
  }).catch(() => console.log('error initializing'));
}

async function delay(delayMs) {
  return new Promise(resolve => {
    setTimeout(() => resolve(), delayMs);
  });
}
