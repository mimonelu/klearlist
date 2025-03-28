import * as fs from "fs"
import * as path from "path"
import { fileURLToPath } from "url"

const LOG_FETCH_DAYS = 1
const MAX_LOG_FETCH_ITERATIONS = 20
const OFFICIAL_URL_SUFFIX = ".bsky.network"
const LOG_RETENTION_DAYS = 90
const NOW = new Date()

async function main () {
  const currentData = await makeCurrentData()
  createDirectory("./log")
  deleteOldLogFiles("./log")
  createLogFile(currentData)
  const entireData = makeEntireData("./log")
  createJsonFile(entireData)
  createReadMe(entireData)
}

function deleteOldLogFiles (dirPath) {
  const retentionDate = new Date(NOW)
  retentionDate.setDate(retentionDate.getDate() - LOG_RETENTION_DAYS)
  const files = fs.readdirSync(dirPath)
  files.forEach((file) => {
    const match = file.match(/^list-(\d+)\.json$/)
    if (match) {
      const fileTime = parseInt(match[1], 10)
      const fileDate = new Date(fileTime)
      if (fileDate < retentionDate) {
        const filePath = path.join(dirPath, file)
        fs.unlinkSync(filePath)
      }
    }
  })
}

async function makeCurrentData () {
  const startedAt = new Date(NOW)
  startedAt.setDate(startedAt.getDate() - LOG_FETCH_DAYS)
  const currentLogs = await fetchCurrentLogs(startedAt, MAX_LOG_FETCH_ITERATIONS)
  const endpoints = makeEndpoints(currentLogs)
  await injectServerInfoToEndpoints(endpoints)
  return {
    startedAt: startedAt.toISOString(),
    endpoints,
  }
}

async function fetchCurrentLogs (startedAt, maxIterations) {
  const currentLogs = []
  for (let i = 0; i < maxIterations; i ++) {
    const logs = await fetchLogs(startedAt.toISOString(), 1000)
    // console.log(startedAt, i, logs.length)
    if (logs == null ||
        logs.length <= 1
    ) {
      return currentLogs
    }
    const createdAt = logs.at(- 1)?.createdAt
    if (createdAt == null) {
      console.error("createdAt is null/undefined.", logs.at(- 1))
      return currentLogs
    }
    startedAt = new Date(createdAt)
    currentLogs.push(...logs)

    // 💕 Drive safely...
    await wait(1000)
  }
  return currentLogs
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
  if (
    response == null ||
    response instanceof Error
  ) {
    console.error("fetchLogs failed.", response)
    return
  }
  return (await response.text())
    ?.split("\n")
    ?.map((text) => JSON.parse(text))
}

function makeEndpoints (currentLogs) {
  const endpointMap = new Map()
  currentLogs.forEach((doc) => {
    const pds = doc.operation?.services?.atproto_pds
    if (
      pds?.type !== "AtprotoPersonalDataServer" ||
      !(pds?.endpoint)
    ) {
      return
    }
    const existing = endpointMap.get(pds.endpoint)
    if (existing != null) {
      existing.createdAt = doc.createdAt
    } else {
      endpointMap.set(pds.endpoint, {
        createdAt: doc.createdAt,
      })
    }
  })
  const endpoints = Object.keys(Object.fromEntries(endpointMap))
    .map((key) => {
      const endpoint = endpointMap.get(key)
      return {
        url: key,
        createdAt: endpoint.createdAt,
      }
    })
  sortEndpoints(endpoints)
  return endpoints
}

async function injectServerInfoToEndpoints (endpoints) {
  for (const endpoint of endpoints) {
    // Skip official server
    if (endpoint.url.endsWith(OFFICIAL_URL_SUFFIX)) {
      continue
    }
    const response = await fetch(
      // SEE: https://docs.bsky.app/docs/api/com-atproto-server-describe-server
      `${endpoint.url}/xrpc/com.atproto.server.describeServer`,
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    )
      .then((response) => response)
      .catch((error) => error)
    if (
      response == null ||
      response instanceof Error
    ) {
      console.error("describeServer failed.", response)
      endpoint.alive = false
      continue
    }
    const json = await response.json()
      .then((response) => response)
      .catch((error) => error)
    if (
      json == null ||
      json instanceof Error
    ) {
      console.error("response.json() failed.", json)
      endpoint.alive = false
      continue
    }
    endpoint.alive = true
    endpoint.inviteCodeRequired = json.inviteCodeRequired ?? false
    endpoint.phoneVerificationRequired = json.phoneVerificationRequired ?? false
  }
}

function sortEndpoints (endpoints) {
  endpoints
    // Sort by createdAt
    .sort((a, b) => {
      return a.createdAt < b.createdAt
        ? 1
        : a.createdAt > b.createdAt
          ? - 1
          : 0
    })
    // Sort by official servers
    .sort((a, b) => {
      const isAOfficial = a.url.endsWith(OFFICIAL_URL_SUFFIX)
      const isBOfficial = b.url.endsWith(OFFICIAL_URL_SUFFIX)
      return isAOfficial && !isBOfficial
        ? - 1
        : !isAOfficial && isBOfficial
          ? 1
          : 0
    })
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
function createDirectory (dirPath) {
  const directoryPath = path.join(__dirname, dirPath)
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath)
  }
}

function createLogFile (currentData) {
  const suffix = NOW.getTime()
  fs.writeFileSync(`./log/list-${suffix}.json`, JSON.stringify(currentData), "utf8")
}

function makeEntireData (dirPath) {
  const filePaths = []
  fs.readdirSync(dirPath).forEach((file) => {
    const filePath = path.join(dirPath, file)
    const stat = fs.statSync(filePath)
    if (!(stat?.isFile())) {
      return
    }
    filePaths.push(filePath)
  })
  filePaths.sort((a, b) => {
    return a < b
      ? 1
      : a > b
        ? - 1
        : 0
  })
  const endpointMap = new Map()
  filePaths.forEach((filePath) => {
    const text = fs.readFileSync(filePath, { encoding: "utf8" })
    const json = JSON.parse(text)
    json.endpoints.forEach((endpoint) => {
      const existing = endpointMap.get(endpoint.url)
      if (existing != null) {
        existing.createdAt = endpoint.createdAt
        if (endpoint.alive != null) {
          existing.alive = endpoint.alive
        }
        if (endpoint.inviteCodeRequired != null) {
          existing.inviteCodeRequired = endpoint.inviteCodeRequired
        }
        if (endpoint.phoneVerificationRequired != null) {
          existing.phoneVerificationRequired = endpoint.phoneVerificationRequired
        }
      } else {
        endpointMap.set(endpoint.url, endpoint)
      }
    })
  })
  const endpoints = Object.keys(Object.fromEntries(endpointMap))
    .map((key) => ({ ...endpointMap.get(key) }))
  sortEndpoints(endpoints)
  removeDeadEndpoints(endpoints)
  return {
    startedAt: NOW.toISOString(),
    endpoints,
  }
}

function removeDeadEndpoints (endpoints) {
  endpoints.splice(
    0,
    endpoints.length,
    ...endpoints.filter((endpoint) => endpoint.alive !== false)
  )
}

function createJsonFile (entireData) {
  fs.writeFileSync(`./list.json`, JSON.stringify(entireData), "utf8")
}

function createReadMe (currentData) {
  const updatedAt = NOW.toLocaleString()
  const list = [
    "|URL|Invite code|Phone verification|",
    "|-|-|-|",
    ...currentData.endpoints.map((endpoint) => {
      return `|${endpoint.url}|${endpoint.inviteCodeRequired ? "Invite required" : "Free to join"}|${endpoint.phoneVerificationRequired ? "Phone required" : "No phone check"}|`
    }),
  ].join("\n")
  const numberOfOfficial = currentData.endpoints.filter((endpoint) => {
    return endpoint.url.endsWith(OFFICIAL_URL_SUFFIX)
  }).length
  const numberOfUnofficial = currentData.endpoints.filter((endpoint) => {
    return !endpoint.url.endsWith(OFFICIAL_URL_SUFFIX)
  }).length
  const numberOfNoInviteRequiredUnofficial = currentData.endpoints.filter((endpoint) => {
    return !endpoint.url.endsWith(OFFICIAL_URL_SUFFIX) && !endpoint.inviteCodeRequired
  }).length
  const readMe = `# ⭐ Klearlist

Klearlist is ATProtocol's PDS list. Note, this list is a partial, not an all. JSON file is [here](./list.json) .

* Official PDS: ${numberOfOfficial}
* 3rd party PDS: ${numberOfUnofficial}
* 3rd party PDS (No invite required): ${numberOfNoInviteRequiredUnofficial}

Updated at ${updatedAt}

${list}

Klearlist © 2024-2025 [mimonelu](https://bsky.app/profile/mimonelu.net)
`
  fs.writeFileSync("./README.md", readMe, "utf8")
}

async function wait (interval) {
  return new Promise((resolve) => {
    setTimeout(resolve, interval)
  })
}

await main()
