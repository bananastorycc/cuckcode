import { parentPort, workerData } from 'node:worker_threads'
import { replacements, search } from './search'

// One search, or the matching half of a replace, off the main thread (see inWorker() in index.ts).
const { root, q, replacement, paths } = workerData
const job = replacement === undefined ? search(root, q) : replacements(root, q, replacement, paths)
job.then((r) => parentPort!.postMessage(r))
