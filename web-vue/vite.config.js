import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import fs from 'node:fs'
import path from 'node:path'

const sharedJobsJsonPath = path.resolve(__dirname, '../public/jobs.json')
const sharedCollegeCoordsPath = path.resolve(__dirname, '../public/college-coords.json')

function sharedJobsJsonPlugin() {
  return {
    name: 'shared-jobs-json',
    configureServer(server) {
      server.middlewares.use('/jobs.json', (_req, res, next) => {
        try {
          const payload = fs.readFileSync(sharedJobsJsonPath, 'utf-8')
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          res.end(payload)
        } catch {
          next()
        }
      })

      server.middlewares.use('/college-coords.json', (_req, res, next) => {
        try {
          const payload = fs.readFileSync(sharedCollegeCoordsPath, 'utf-8')
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          res.end(payload)
        } catch {
          next()
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), sharedJobsJsonPlugin()],
})
