import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

import {
  findPluginRoot,
  GDocReview,
  isPluginRoot,
  LogEntry,
  Logger,
  LogLevel,
  PluginConfig,
  PluginRoot,
  resolvePluginRoot
} from "claude-gdoc-review-plugin"

import { TestEnvironment } from "../support/testEnvironment.js"

const RepositoryRoot = resolve(__dirname, "..", "..")

describe("isPluginRoot", () => {
  let candidatePath: string = null

  beforeEach(async () => {
    candidatePath = await mkdtemp(
      TestEnvironment.newTemporaryDirectoryTemplate("root-")
    )
  })

  afterEach(async () => {
    await rm(candidatePath, { recursive: true, force: true })
  })

  async function writeSubpath(subpath: string): Promise<void> {
    const file = resolve(candidatePath, subpath)

    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, "", "utf8")
  }

  it("accepts a directory holding both required files", async () => {
    await writeSubpath(PluginRoot.TemplateSubpath)
    await writeSubpath(PluginRoot.BundleSubpath)

    expect(isPluginRoot(candidatePath)).toBe(true)
    expect(isPluginRoot(RepositoryRoot)).toBe(true)
  })

  it("refuses a directory holding only the protocol template", async () => {
    await writeSubpath(PluginRoot.TemplateSubpath)

    // The renderer would work and the Bash allow-list would be built around a
    // launcher that does not exist, which looks like "the plugin does nothing".
    expect(isPluginRoot(candidatePath)).toBe(false)
  })

  it("refuses a directory holding only the bundle", async () => {
    await writeSubpath(PluginRoot.BundleSubpath)

    expect(isPluginRoot(candidatePath)).toBe(false)
  })

  it("refuses an empty directory and a missing candidate", () => {
    expect(isPluginRoot(candidatePath)).toBe(false)
    expect(isPluginRoot("")).toBe(false)
    expect(isPluginRoot(null)).toBe(false)
  })
})

describe("findPluginRoot", () => {
  it("finds the plugin root from a nested directory such as dist/", () => {
    expect(findPluginRoot(resolve(RepositoryRoot, "dist"))).toBe(RepositoryRoot)
    expect(findPluginRoot(resolve(RepositoryRoot, "src", "round"))).toBe(
      RepositoryRoot
    )
  })

  it("falls back to the start directory when no ancestor is a plugin root", () => {
    expect(findPluginRoot("/")).toBe("/")
  })

  it("skips an ancestor that holds the template but no bundle", async () => {
    const partialRoot = await mkdtemp(
        TestEnvironment.newTemporaryDirectoryTemplate("root-")
      ),
      nestedPath = resolve(partialRoot, "skills", "gdoc-review")

    await mkdir(nestedPath, { recursive: true })
    await writeFile(
      resolve(partialRoot, PluginRoot.TemplateSubpath),
      "",
      "utf8"
    )

    expect(findPluginRoot(nestedPath)).toBe(nestedPath)
    await rm(partialRoot, { recursive: true, force: true })
  })

  it("demands a start directory", () => {
    expect(() => findPluginRoot("")).toThrow()
    expect(() => findPluginRoot(null)).toThrow()
  })
})

describe("resolvePluginRoot", () => {
  const originalEnvironment = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnvironment }
  })

  it("prefers the environment variable Claude Code sets", () => {
    process.env[GDocReview.PluginRootEnvironmentKey] = RepositoryRoot

    expect(resolvePluginRoot()).toBe(RepositoryRoot)
  })

  it("ignores an environment value that does not hold this plugin, and says so", async () => {
    const configDirectoryPath = await mkdtemp(
      TestEnvironment.newTemporaryDirectoryTemplate("root-config-")
    )

    process.env[PluginConfig.ConfigDirectoryEnvironmentKey] =
      configDirectoryPath
    process.env[GDocReview.PluginRootEnvironmentKey] = tmpdir()

    expect(resolvePluginRoot()).not.toBe(tmpdir())
    expect(resolve(resolvePluginRoot(), PluginRoot.TemplateSubpath)).toBe(
      resolve(RepositoryRoot, PluginRoot.TemplateSubpath)
    )

    const logFile = join(
        configDirectoryPath,
        GDocReview.StateDirName,
        Logger.FileName
      ),
      warnings = (await readFile(logFile, "utf8"))
        .split(Logger.LineSeparator)
        .filter(line => line.length > 0)
        .map(line => JSON.parse(line) as LogEntry)
        .filter(entry => entry.level === LogLevel.warn)
        .map(entry => entry.message)

    // A stale value silently disables the renderer and the Bash allow-list,
    // which looks like "the plugin does nothing" rather than like an error.
    expect(
      warnings.some(message => message.includes(PluginRoot.ForeignRootMessage))
    ).toBe(true)
    expect(warnings.some(message => message.includes(tmpdir()))).toBe(true)

    await rm(configDirectoryPath, { recursive: true, force: true })
  })

  it("falls back to the ancestor holding the protocol template", () => {
    delete process.env[GDocReview.PluginRootEnvironmentKey]

    expect(resolve(resolvePluginRoot(), PluginRoot.TemplateSubpath)).toBe(
      resolve(RepositoryRoot, PluginRoot.TemplateSubpath)
    )
  })

  it("treats an empty environment value as unset", () => {
    process.env[GDocReview.PluginRootEnvironmentKey] = ""

    expect(resolvePluginRoot()).not.toBe("")
  })
})
