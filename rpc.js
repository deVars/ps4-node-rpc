const IP = "192.168.90.120",
      RPC_PORT = 733,
      SOCKET_BYTES_BUFFER_LIMIT = 128,
      SOCKET_BUFFER_FULL_WAIT_MS = 32;

const {Socket} = require('net');
const BigNum = require('bignum');
const rpcCommand = {
  MEM_READ:         0xBD000001,
  MEM_WRITE:        0xBD000002,
  PROC_LIST:        0xBD000003,
  PROC_INFO:        0xBD000004,
  PROC_INSTALL:     0xBD000005,
  PROC_CALL:        0xBD000006,
  PROC_ELF:         0xBD000007,
  END:              0xBD000008,
  REBOOT:           0xBD000009,
  KERN_BASE:        0xBD00000A,
  KERN_READ:        0xBD00000B,
  KERN_WRITE:       0xBD00000C
};

module.exports = {
  getPS4RPC, getProcList, getProcInfo, writeMem, getPid,
};

let pid, memSection;
// getPS4RPC()
//   .then(getProcList)
//   .then(sock => {
//     // console.log(sock.data);
//     pid = getPid(sock.data, 'eboot.bin');
//     return getProcInfo(sock, pid);
//   })
//   .then(sock => {
//     // console.log(sock.data);
//     memSection = sock.data[3];
//     return writeMem(sock, pid, memSection.start + 0x2d5558, Buffer.from('BA6C', 'hex'));
//   })
//   .then(sock => {
//     sock.end();
//   });


async function getProcList(sock) {
  const procListEntrySize = 36,
        extraArgSize = 0;
  return new Promise(resolve => {
    sock.send(
      getCommandPacket(rpcCommand.PROC_LIST, extraArgSize),
      procListEntrySize
    )
    .then(sock => {
      resolve(parseProcList(sock.data));
    });
  });

  function parseProcList(data) {
    const entryCount = data.length / procListEntrySize;
    console.log('parsing proc list');
    return Array.from({length: entryCount}, (_, index) => {
      const entryStart = index * procListEntrySize,
            entryEnd = (index + 1) * procListEntrySize,
            entry = data.slice(entryStart, entryEnd),
            entryText = entry.slice(0, procListEntrySize - 4),
            entryPid = entry.slice(procListEntrySize - 4, procListEntrySize);
      return {
        name: readCString(entryText),
        pid: entryPid.readUInt32LE(0)
      };
    });
  }
}

async function getProcInfo(sock, pid) {
  const procInfoArgSize = 4,
        procInfoEntrySize = 60;
  return new Promise(resolve => {
    console.log('using pid', pid);
    sock.send(
        getCommandPacket(
          rpcCommand.PROC_INFO,
          procInfoArgSize,
          pid
        ),
        procInfoEntrySize,
        true
      )
      .then(sock => {
        resolve(parseProcInfo(sock.data));
      });

    function parseProcInfo(data) {
      const entryCount = data.length / procInfoEntrySize;
      console.log('parsing proc info');
      return Array.from({length: entryCount}, (_, index) => {
        const entryStart = index * procInfoEntrySize,
          entryEnd = (index + 1) * procInfoEntrySize,
          entry = data.slice(entryStart, entryEnd),
          entryText = entry.slice(0, 32),
          entryProcStart = entry.slice(32, 40),
          entryProcEnd = entry.slice(40, 48),
          entryProcOffset = entry.slice(48, 56),
          entryProcProt = entry.slice(56),
          bufOptions = {endian: 'little', size: 8};
        // console.log(entryProcEnd, BigNum.fromBuffer(entryProcEnd, {endian: 'little', size: 8}).toString(16));
        return {
          name: readCString(entryText),
          start: BigNum.fromBuffer(entryProcStart, bufOptions),
          end: BigNum.fromBuffer(entryProcEnd, bufOptions),
          offset: BigNum.fromBuffer(entryProcOffset, bufOptions),
          prot: BigNum.fromBuffer(entryProcProt),
        };
      });
    }
  });
}

async function writeMem(sock, pid, address, data) {
  const writeMemArgSize = 16,
        writeMemEntrySize = 1;
  let addressLow32Bits, addressHigh32Bits;
  if (BigNum.isBigNum(address)) {
    addressLow32Bits = address.and(parseInt('FFFFFFFF', 16));
    addressHigh32Bits = address.shiftRight(32);
  } else {
    addressLow32Bits = address;
    addressHigh32Bits = 0;
  }
  // console.log('writeMem', addressLow32Bits.toString(16), addressHigh32Bits.toString(16));
  return new Promise(resolve => {
    sock.send(
        getCommandPacket(
          rpcCommand.MEM_WRITE,
          writeMemArgSize,
          pid,
          addressLow32Bits,
          addressHigh32Bits,
          data.length),
        writeMemEntrySize,
        false // writeMem just needs a verify in order to pass the write data
      )
      .then(sock => {
        return sock.send(data, -1, false);
      })
      .then(() => resolve());
  });
}

async function getPS4RPC() {
  const sock = new Socket(),
        resolveData = {send: send, sendAnd: sendAnd, end: end, data: null};
  let dataBuffers = [],
      dataBuffersLen = 0,
      resolverFn = () => {},
      expectIncomingData = true,
      incomingDataEntryCount = 0,
      incomingDataEntrySize = 1;
  sock.setTimeout(3000);
  // sock.setNoDelay(true);
  sock.on('data', handleData);
  sock.on('timeout', () => {
    console.log('socket timed out.');
    sock.end();
  });
  return new Promise(resolve => {
    sock.connect(RPC_PORT, IP, () => {
      resolve(resolveData);
    });
  });

  function end() {
    sock.end();
  }

  function checkSocketBufferForOverflow(sock) {
    return new Promise(async resolve => {
      while (SOCKET_BYTES_BUFFER_LIMIT < sock.bufferSize) {
        await delay(SOCKET_BUFFER_FULL_WAIT_MS);
      }
      resolve(sock);
    });

    async function delay(delay) {
      return new Promise(resolve => {
        setTimeout(() => resolve(), delay);
      });
    }
  }

  function setIncomingDataOverrides(incomingDataEntrySizeOverride, shouldExpectIncomingDataOverride) {
    incomingDataEntryCount = 0;
    expectIncomingData = shouldExpectIncomingDataOverride;
    if (incomingDataEntrySizeOverride > 0) {
      incomingDataEntrySize = incomingDataEntrySizeOverride;
    }
  }

  function send(buf, incomingDataEntrySizeOverride = 0, shouldExpectIncomingDataOverride = true) {
    return new Promise(resolve => {
      checkSocketBufferForOverflow(sock)
        .then(sock => {
          setIncomingDataOverrides(incomingDataEntrySizeOverride, shouldExpectIncomingDataOverride);
          resolverFn = resolve;
          sock.write(buf);
        });
    });
  }

  function sendAnd(buf, incomingDataEntrySizeOverride = 0, shouldExpectIncomingDataOverride = false) {
    return new Promise(resolve => {
      checkSocketBufferForOverflow(sock)
        .then(sock => {
          setIncomingDataOverrides(incomingDataEntrySizeOverride, shouldExpectIncomingDataOverride);
          sock.write(buf, null, () => resolve(resolveData));
        });
    });
  }

  function handleData(data) {
    // console.log(`data received: ${data.length}, expected struct length: ${incomingDataEntrySize}, expectIncomingData: ${expectIncomingData}`);
    dataBuffers.push(data);
    dataBuffersLen += data.length;
    if (!expectIncomingData && incomingDataEntryCount === 0 && dataBuffersLen === 4) {
      // no incoming data just a status flag
      let concatData = Buffer.concat(dataBuffers);
      const {isSuccess, incomingDataLen, reqStatus} = verify(concatData);
      // console.log(`isSuccess: ${isSuccess}, incomingDataLen: ${incomingDataLen}, reqStatus: ${reqStatus.toString(16)}`);
      dataBuffersLen = 0;
      dataBuffers = [];
      resolverFn(resolveData);
    }
    else if (incomingDataEntryCount === 0 && dataBuffersLen >= 8) {
      // we have buffered data and we still don't know if there's incoming
      let concatData = Buffer.concat(dataBuffers),
          verifyData = concatData.slice(0, 8);
      dataBuffers = [concatData.slice(8)];
      dataBuffersLen -= 8;
      // console.log('verifyData', verifyData);
      const {isSuccess, incomingDataLen, reqStatus} = verify(verifyData);
      // console.log(`isSuccess: ${isSuccess}, incomingDataLen: ${incomingDataLen}, reqStatus: ${reqStatus.toString(16)}`);
      if (isSuccess) {
        incomingDataEntryCount = incomingDataLen;
        tryResolveIfDataRequirementsAreMet()
      } else {
        dataBuffersLen = 0;
        dataBuffers = [];
        resolverFn(resolveData);
      }
    } else if (incomingDataEntryCount > 0) {
      tryResolveIfDataRequirementsAreMet();
    }

    function verify(data) {
      let reqStatus = data.readUInt32LE(0),
        incomingDataLen = 0,
        isReqSuccess = reqStatus === 0x80000000;
      if (data.length > 7) {
        incomingDataLen = data.readUInt32LE(4);
      }
      return {
        isSuccess: isReqSuccess,
        reqStatus,
        incomingDataLen
      };
    }

    function tryResolveIfDataRequirementsAreMet() {
      const expectedLen = incomingDataEntryCount * incomingDataEntrySize;
      if (dataBuffersLen >= expectedLen) {
        let newResolveData = Object.assign({}, resolveData, {
          data: Buffer.concat(dataBuffers, expectedLen)
        });
        dataBuffersLen = 0;
        dataBuffers = [];
        resolverFn(newResolveData);
      }
    }
  }
}

function getCommandPacket(rpcCommand, ...extraArgData) {
  const commandPacketSize = 8 + (extraArgData.length * 4),
        commandPacketPrefix = 0xBDAABBCC;
  let buf = Buffer.allocUnsafe(commandPacketSize),
      offset = buf.writeUInt32LE(commandPacketPrefix, 0);
  offset = buf.writeUInt32LE(rpcCommand, offset);
  for (let extraArgs of extraArgData) {
    offset = buf.writeUInt32LE(extraArgs, offset);
  }
  // console.log('sending command packet', buf);
  return buf;
}

function getPid(pidList, pidName) {
  return pidList.reduce((current, pidListEntry) => {
    if (current) {
      return current;
    }
    return pidListEntry.name === pidName ? pidListEntry.pid : null;
  }, null);
}

function readCString(buf, offset = 0) {
  const cStrLen = buf.indexOf(0, offset);
  if (cStrLen === -1) {
    return ``;
  }
  return buf.slice(offset, cStrLen).toString('utf-8');
}