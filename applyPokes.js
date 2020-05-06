const {getPS4RPC, getProcList, getProcInfo, writeMem, getPid} = require('./rpc');
const bignum = require('bignum');
const startTimestamp = (new Date()).getTime();

if (process.argv.length < 3) {
  console.log(`usage: node applyPokes <path-to-cht-file>`);
}

require('fs').readFile(process.argv[2], 'utf-8', readFileHandler);

async function readFileHandler (err, data) {
  const separator = ',';  // use csv format since it is close to pipe format cht uses
  if (err) {
    throw err;
  }

  const rpcIntervalDelay = 100,
        lines = data.split('\n'),
        targetProcess = lines[0].split(separator)[1];

  const connectSock = await getPS4RPC(),
        procList = await getProcList(connectSock),
        targetPid = getPid(procList, targetProcess),
        memSections = await getProcInfo(connectSock, targetPid),
        pokeData = lines.slice(1)
                      .map(line => getPokeData(memSections, line))
                      .filter(data => !!data);
  connectSock.end();

  while (1) {
    const sock = await getPS4RPC();
    await applyPokes(sock, targetPid, pokeData);
    sock.end();
    await delay(rpcIntervalDelay);
  }


  async function delay(delay) {
    return new Promise(resolve => {
      setTimeout(() => resolve(), delay);
    });
  }

  function getPokeData(memSections, line) {
    const cols = line.split(separator);
    if (cols.length < 5) {
      return null;
    }
    const memSectionIndex = parseInt(cols[1], 10),
          offset = bignum(cols[2], 16),
          value = cols[3] === 'hex' ? Buffer.from(cols[4], 'hex') : null,
          enable = !!parseInt(cols[5], 10),
          effectiveAddress = memSections[memSectionIndex].end.add(offset);
    // console.debug('memsection start', memSections[memSectionIndex].start.toString(16));
    // console.debug('memsection end', memSections[memSectionIndex].end.toString(16));
    // console.debug('effectiveAddress', effectiveAddress.toString(16));
    // console.debug('effectiveAddress', effectiveAddress.toString(16));
    return {
      memSectionIndex,
      offset,
      value,
      enable,
      effectiveAddress,
    };
  }

  function applyPokes(sock, targetPid, pokeData) {
    return new Promise(async resolve => {
      const enabledPokeData = pokeData.filter(pokeDatum => pokeDatum.enable);
      for (let pokeEntry of enabledPokeData) {
        // console.log(`writing to ${pokeDatum.effectiveAddress.toString(16)} with ${pokeDatum.value.toString('hex')}`);
        await writeMem(sock, targetPid, pokeEntry.effectiveAddress, pokeEntry.value);
      }
      const nowTimestamp = ((new Date()).getTime() - startTimestamp) / 1000;
      console.log(`[${nowTimestamp}] written to ${enabledPokeData.length} sections`);
      resolve();
    });
  }
}

