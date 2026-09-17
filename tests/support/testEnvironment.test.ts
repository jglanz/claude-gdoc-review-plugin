import { spawnSync } from "node:child_process"
import { mkdir, rm, stat } from "node:fs/promises"
import path from "node:path"

import removeRunDirectory, { TestEnvironment } from "./testEnvironment.js"

/** Name of the throwaway directory standing in for a run directory. */
const FakeRunDirectoryName = "fake-run"

/** Name of a directory beside it that the teardown must leave alone. */
const SiblingDirectoryName = "fake-run-sibling"

/** Permission bits of a directory, without its file-type bits. */
const PermissionMask = 0o777

/** Worker id a spawned child is told it is running under. */
const SpawnedWorkerId = "3"

/** Program the spawned child runs: print the exported run directory and nothing else. */
const PrintRunDirectoryProgram = `process.stdout.write(String(process.env[${JSON.stringify(TestEnvironment.RunDirectoryEnvironmentKey)}]))`

describe("TestEnvironment", () => {
  const originalEnvironment = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnvironment }
  })

  describe("newRunDirectoryPath", () => {
    it("names the directory globalSetup exported", () => {
      const exported = path.join(
        TestEnvironment.createRunDirectory(),
        "exported"
      )

      process.env[TestEnvironment.RunDirectoryEnvironmentKey] = exported

      expect(TestEnvironment.newRunDirectoryPath()).toBe(exported)
    })

    it("refuses to guess when the variable is unset", () => {
      delete process.env[TestEnvironment.RunDirectoryEnvironmentKey]

      expect(() => TestEnvironment.newRunDirectoryPath()).toThrow(
        TestEnvironment.MissingRunDirectoryMessage
      )
    })

    it("treats an empty exported value as unset", () => {
      process.env[TestEnvironment.RunDirectoryEnvironmentKey] = ""

      expect(() => TestEnvironment.newRunDirectoryPath()).toThrow(
        TestEnvironment.MissingRunDirectoryMessage
      )
    })

    it("was created by globalSetup under the documented prefix", async () => {
      const runDirectoryPath = TestEnvironment.newRunDirectoryPath()

      await expect(stat(runDirectoryPath)).resolves.toBeDefined()
      // The prefix is spelled in globalSetup.ts too, which cannot import this
      // module; this is what catches the two spellings drifting apart.
      expect(path.basename(runDirectoryPath)).toContain(
        TestEnvironment.RunDirectoryPrefix
      )
    })
  })

  describe("createRunDirectory", () => {
    it("has already made the directory this worker writes into", async () => {
      const runDirectoryPath = TestEnvironment.createRunDirectory()

      await expect(stat(runDirectoryPath)).resolves.toBeDefined()
      expect(process.env[TestEnvironment.RunDirectoryEnvironmentKey]).toBe(
        runDirectoryPath
      )
    })

    it("is idempotent and owner-only", async () => {
      const first = TestEnvironment.createRunDirectory(),
        second = TestEnvironment.createRunDirectory(),
        stats = await stat(first)

      expect(second).toBe(first)
      expect(stats.mode & PermissionMask).toBe(TestEnvironment.DirectoryMode)
    })

    it("hands the same directory to a child that thinks it is a worker", () => {
      const runDirectoryPath = TestEnvironment.createRunDirectory(),
        child = spawnSync(process.execPath, ["-e", PrintRunDirectoryProgram], {
          encoding: "utf8",
          env: {
            ...process.env,
            [TestEnvironment.WorkerIdEnvironmentKey]: SpawnedWorkerId
          }
        })

      // A worker used to derive the path from process ancestry; it now reads
      // the one variable globalSetup exported, so a child inherits it whatever
      // its own pid and parent happen to be.
      expect(child.status).toBe(0)
      expect(child.stdout).toBe(runDirectoryPath)
    })
  })

  describe("newTemporaryDirectoryTemplate", () => {
    it("puts every template inside the run directory", () => {
      const template = TestEnvironment.newTemporaryDirectoryTemplate("store-")

      expect(path.dirname(template)).toBe(TestEnvironment.createRunDirectory())
      expect(path.basename(template)).toBe("store-")
    })

    it("names the worker in its config directory template", () => {
      const template = TestEnvironment.newConfigDirectoryTemplate("7")

      expect(path.dirname(template)).toBe(TestEnvironment.createRunDirectory())
      expect(path.basename(template)).toBe(
        `${TestEnvironment.ConfigDirectoryPrefix}7-`
      )
    })
  })

  describe("removeRunDirectory", () => {
    it("removes the run directory and nothing beside it", async () => {
      const runDirectoryPath = TestEnvironment.createRunDirectory(),
        fakeRunPath = path.join(runDirectoryPath, FakeRunDirectoryName),
        siblingPath = path.join(runDirectoryPath, SiblingDirectoryName)

      await mkdir(path.join(fakeRunPath, "state"), { recursive: true })
      await mkdir(siblingPath, { recursive: true })

      // The teardown is pointed at the throwaway directory, because the real
      // one holds the state of every test still running in this worker.
      process.env[TestEnvironment.RunDirectoryEnvironmentKey] = fakeRunPath
      try {
        removeRunDirectory()
      } finally {
        process.env[TestEnvironment.RunDirectoryEnvironmentKey] =
          runDirectoryPath
      }

      await expect(stat(fakeRunPath)).rejects.toThrow()
      await expect(stat(siblingPath)).resolves.toBeDefined()

      await rm(siblingPath, { recursive: true, force: true })
    })

    it("is silent about a run directory that was never created", () => {
      process.env[TestEnvironment.RunDirectoryEnvironmentKey] = path.join(
        TestEnvironment.createRunDirectory(),
        "never-made"
      )

      expect(() => removeRunDirectory()).not.toThrow()
    })
  })
})
