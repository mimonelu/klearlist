import * as fs from "fs"

const DAYS = 7
const MAX_ITERATION = 70

async function main () {
  const entireData = await makeEntireData()
  createJson(entireData)
  createReadMe(entireData)
}

async function makeEntireData() {
  const startedAt = new Date()
  startedAt.setDate(startedAt.getDate() - DAYS)
  const entireLogs = await fetchEntireLogs(startedAt, MAX_ITERATION)
  const endpoints = makeEndpoints(entireLogs)
  return {
    startedAt: startedAt.toISOString(),
    endpoints,
  }
}

async function fetchEntireLogs (startedAt, maxIteration) {
  const entireLogs = []
  for (let i = 0; i < maxIteration; i ++) {
    const logs = await fetchLogs(startedAt.toISOString(), 1000)
    // console.log(startedAt, i, logs.length)
    if (logs == null ||
        logs.length <= 1
    ) {
      return entireLogs
    }
    const createdAt = logs.at(- 1)?.createdAt
    if (createdAt == null) {
      console.error("createdAt is null/undefined.", logs.at(- 1))
      return entireLogs
    }
    startedAt = new Date(createdAt)
    entireLogs.push(...logs)

    // 💕 Drive safely...
    await wait(1000)
  }
  return entireLogs
}

async function fetchLogs (after, count = 1000) {
  const response = await fetch(
    // SEE: https://web.plc.directory/spec/v0.1/did-plc
    `https://plc.directory/export?after=${after}&count=${count}`,
    {
      headers: {
        "Content-Type": "application/json",
      },
    }
  )
    .then((response) => response)
    .catch((error) => error)
  if (response == null ||
      response instanceof Error
  ) {
    console.error("fetchLogs is failed.", after)
    return
  }
  return (await response.text())
    ?.split("\n")
    ?.map((text) => JSON.parse(text))
}

function makeEndpoints (entireLogs) {
  const endpointMap = new Map()
  entireLogs.forEach((doc) => {
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

  // Sort by URL
  endpoints.sort((a, b) => {
    return a.url < b.url
      ? - 1
      : a.url > b.url
        ? 1
        : 0
  })

  return endpoints
}

function createJson (entireData) {
  fs.writeFileSync("./list.json", JSON.stringify(entireData), "utf8")
}

function createReadMe (entireData) {
  const startedAt = new Date(entireData.startedAt).toLocaleString()
  const endedAt = (new Date()).toLocaleString()
  const list = entireData.endpoints.map((endpoint) => {
    return `* ${endpoint.url} : ${endpoint.count}`
  }).join("\n")
  const readMe = `# ⭐ Klearlist
Klearlist is a ATProtocol's PDS list. Note, this list is a partial, not an all.
JSON file is [here](./list.json) .
Term: ${startedAt} - ${endedAt}

${list}

Klearlist © 2024 [mimonelu](https://bsky.app/profile/mimonelu.net)
`
  fs.writeFileSync("./README.md", readMe, "utf8")
}

async function wait (interval) {
  return new Promise((resolve) => {
    setTimeout(resolve, interval)
  })
}

await main()
