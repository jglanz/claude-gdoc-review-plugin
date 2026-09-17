import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises"
import path from "node:path"

import {
  ensureDirectory,
  fileExists,
  FsUtils,
  NestedError,
  readTextFileOrNull,
  writeFileAtomic
} from "claude-gdoc-review-plugin"

import { TestEnvironment } from "../support/testEnvironment.js"

const ModeMask = 0o777,
  WindowsPlatform = "win32"

describe("fsUtils", () => {
  let workingPath: string = null

  beforeEach(async () => {
    workingPath = await mkdtemp(
      TestEnvironment.newTemporaryDirectoryTemplate("fs-")
    )
  })

  afterEach(async () => {
    await rm(workingPath, { recursive: true, force: true })
  })

  describe("ensureDirectory", () => {
    it("creates every missing parent and returns the path", async () => {
      const directoryPath = path.join(workingPath, "reviews", "nested")

      expect(await ensureDirectory(directoryPath)).toBe(directoryPath)
      expect(await fileExists(directoryPath)).toBe(true)
    })

    it("creates the directory owner-only", async () => {
      const directoryPath = path.join(workingPath, "owner-only")

      await ensureDirectory(directoryPath)

      if (process.platform !== WindowsPlatform) {
        expect((await stat(directoryPath)).mode & ModeMask).toBe(
          FsUtils.DirectoryMode
        )
      }
    })

    it("is idempotent", async () => {
      const directoryPath = path.join(workingPath, "sessions")
      await ensureDirectory(directoryPath)

      await expect(ensureDirectory(directoryPath)).resolves.toBe(directoryPath)
    })

    it("wraps a failure in a NestedError", async () => {
      const blockingFile = path.join(workingPath, "blocker")
      await writeFileAtomic(blockingFile, "not a directory")

      await expect(
        ensureDirectory(path.join(blockingFile, "child"))
      ).rejects.toBeInstanceOf(NestedError)
    })
  })

  describe("writeFileAtomic", () => {
    it("writes the content and leaves no temporary file behind", async () => {
      const file = path.join(workingPath, "state.json")
      await writeFileAtomic(file, '{"version":1}')

      expect(await readFile(file, FsUtils.Encoding)).toBe('{"version":1}')
      expect(await readdir(workingPath)).toEqual(["state.json"])
    })

    it("writes the file owner-only", async () => {
      const file = path.join(workingPath, "owner-only.json")
      await writeFileAtomic(file, '{"version":1}')

      if (process.platform !== WindowsPlatform) {
        expect((await stat(file)).mode & ModeMask).toBe(FsUtils.FileMode)
      }
    })

    it("replaces existing content", async () => {
      const file = path.join(workingPath, "state.json")
      await writeFileAtomic(file, "first")
      await writeFileAtomic(file, "second")

      expect(await readFile(file, FsUtils.Encoding)).toBe("second")
      expect(await readdir(workingPath)).toEqual(["state.json"])
    })

    it("wraps a failure in a NestedError", async () => {
      const blockingFile = path.join(workingPath, "blocker")
      await writeFileAtomic(blockingFile, "not a directory")

      await expect(
        writeFileAtomic(path.join(blockingFile, "child.json"), "x")
      ).rejects.toBeInstanceOf(NestedError)
      expect(await readdir(workingPath)).toEqual(["blocker"])
    })
  })

  describe("readTextFileOrNull", () => {
    it("reads an existing file", async () => {
      const file = path.join(workingPath, "plan.md")
      await writeFileAtomic(file, "# Plan")

      expect(await readTextFileOrNull(file)).toBe("# Plan")
    })

    it("returns null for a file that does not exist", async () => {
      expect(
        await readTextFileOrNull(path.join(workingPath, "absent.md"))
      ).toBeNull()
    })

    it("wraps any other failure in a NestedError", async () => {
      await expect(readTextFileOrNull(workingPath)).rejects.toBeInstanceOf(
        NestedError
      )
    })
  })

  describe("fileExists", () => {
    it("is true for an existing path and false otherwise", async () => {
      const file = path.join(workingPath, "present")
      await writeFileAtomic(file, "here")

      expect(await fileExists(file)).toBe(true)
      expect(await fileExists(path.join(workingPath, "absent"))).toBe(false)
    })
  })
})
