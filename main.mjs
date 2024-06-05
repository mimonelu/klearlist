import * as fs from "fs"

const DAYS = 7
const MAX_ITERATION = 70

async function main () {
  const list = await makeList()
  createJson(list)
  createReadMe(list)
}

async function makeList() {
  const startedAt = new Date()
  startedAt.setDate(startedAt.getDate() - DAYS)
  const plcs = await fetchPlcs(startedAt, MAX_ITERATION)

  const endpointMap = new Map()
  plcs.forEach((doc) => {
    const pds = doc.operation?.services?.atproto_pds
    if (pds?.type !== "AtprotoPersonalDataServer" ||
      !(pds?.endpoint)
    ) {
      return
    }
    const existing = endpointMap.get(pds.endpoint)
    if (existing != null) {
      existing.count ++
    } else {
      endpointMap.set(pds.endpoint, {
        count: 1,
      })
    }
  })

  const endpoints = Object.keys(Object.fromEntries(endpointMap))
    .map((key) => {
      const endpoint = endpointMap.get(key)
      return {
        url: key,
        count: endpoint.count,
      }
    })
  endpoints.sort((a, b) => a.url < b.url ? - 1 : a.url > b.url ? 1 : 0)

  return {
    startedAt: startedAt.toISOString(),
    endpoints,
  }
}

async function fetchPlcs (startedAt, maxIteration) {
  const plcs = []
  for (let i = 0; i < maxIteration; i ++) {
    const plc = await fetchPlc(startedAt.toISOString(), 1000)
    // console.log(startedAt, i, plc.length)
    if (plc == null || plc.length <= 1) {
      return plcs
    }
    const createdAt = plc.at(- 1)?.createdAt
    if (createdAt == null) {
      console.error("createdAt is nullified.", plc.at(- 1))
      return plcs
    }
    startedAt = new Date(createdAt)
    plcs.push(...plc)
    await wait(1000)
  }
  return plcs
}

async function fetchPlc (after, count = 1000) {
  const response = await fetch(
    `https://plc.directory/export?after=${after}&count=${count}`,
    {
      headers: {
        "Content-Type": "application/json",
      },
    }
  )
    .then((response) => response)
    .catch((error) => error)
  if (response instanceof Error || response == null) {
    console.error("fetchPlc is failed.", after)
    return
  }
  return (await response.text())?.split("\n")?.map((text) => JSON.parse(text))
}

function createJson (list) {
  fs.writeFileSync("./list.json", JSON.stringify(list), "utf8")
}

function createReadMe (list) {
  const readMe = ["# Klearlist\n"]
  readMe.push(`Term: ${new Date(list.startedAt).toLocaleString()} - ${(new Date()).toLocaleString()}\n`)
  readMe.push(...list.endpoints.map((endpoint) => `* ${endpoint.url} : ${endpoint.count}`))
  fs.writeFileSync("./README.md", readMe.join("\n"), "utf8")
}

async function wait (interval) {
  return new Promise((resolve) => {
    setTimeout(resolve, interval)
  })
}

await main()
