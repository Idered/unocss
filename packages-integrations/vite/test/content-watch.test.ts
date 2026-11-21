import type { FSWatcher } from 'chokidar'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import presetWind3 from '@unocss/preset-wind3'
import UnoCSS from '@unocss/vite'
import { watch } from 'chokidar'
import { createServer } from 'vite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Keep the real chokidar, but record the watchers UnoCSS opens.
vi.mock('chokidar', async (importOriginal) => {
  const chokidar = await importOriginal<typeof import('chokidar')>()
  return { ...chokidar, watch: vi.fn(chokidar.watch) }
})

describe('vite filesystem content watcher', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'unocss-content-watch-'))
    await writeFile(join(root, 'slides.md'), '<div class="flex"></div>')
    vi.mocked(watch).mockClear()
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('closes the filesystem watcher when the dev server restarts or closes', async () => {
    // The watcher is opened in the background after the server starts.
    async function openedWatchers(count: number): Promise<FSWatcher[]> {
      await vi.waitFor(() => expect(watch).toHaveBeenCalledTimes(count))
      return vi.mocked(watch).mock.results.map(result => result.value)
    }

    const server = await createServer({
      root,
      configFile: false,
      publicDir: false,
      logLevel: 'silent',
      mode: 'development',
      server: { middlewareMode: true, ws: false },
      optimizeDeps: { noDiscovery: true },
      plugins: [
        UnoCSS({
          configFile: false,
          presets: [presetWind3()],
          content: { filesystem: ['slides.md'] },
        }),
      ],
    })

    let watchers: FSWatcher[] = []
    try {
      watchers = await openedWatchers(1)
      expect(watchers.map(watcher => watcher.closed)).toEqual([false])

      // The new server reuses the plugin and starts before the old one closes,
      // so only the old server's watcher must be closed here.
      await server.restart()
      watchers = await openedWatchers(2)
      expect(watchers.map(watcher => watcher.closed)).toEqual([true, false])
    }
    finally {
      await server.close()
    }

    expect(watchers.map(watcher => watcher.closed)).toEqual([true, true])
  })
})
