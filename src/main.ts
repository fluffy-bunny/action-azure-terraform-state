import * as core from '@actions/core'
import {wait} from './wait'
import * as crypto from 'crypto'
import * as exec from '@actions/exec'
import * as io from '@actions/io'

let azPath: string
const prefix = process.env.AZURE_HTTP_USER_AGENT
  ? `${process.env.AZURE_HTTP_USER_AGENT}`
  : ''

async function run(): Promise<void> {
  try {
    // Set user agent varable
    const usrAgentRepo = crypto
      .createHash('sha256')
      .update(`${process.env.GITHUB_REPOSITORY}`)
      .digest('hex')
    const actionName = 'AzureTerraformSetup'
    const prefix2 = prefix ? `${prefix}+` : ''

    const userAgentString = `${prefix2}GITHUBACTIONS_${actionName}_${usrAgentRepo}`
    core.exportVariable('AZURE_HTTP_USER_AGENT', userAgentString)

    azPath = await io.which('az', true)
    await executeAzCliCommand('--version')

    const shortName: string = core.getInput('shortName')
    core.info(`shortName ${shortName}...`)

    const ms: string = core.getInput('milliseconds')
    core.debug(`Waiting ${ms} milliseconds ...`)

    core.debug(new Date().toTimeString())
    await wait(parseInt(ms, 10))
    core.debug(new Date().toTimeString())

    core.setOutput('time', new Date().toTimeString())
  } catch (error) {
    core.setFailed(error.message)
  }
}

async function executeAzCliCommand(command: string): Promise<void> {
  try {
    await executeCliCommand(azPath, command)
  } catch (error) {
    throw new Error(error)
  }
}

async function executeCliCommand(
  cliPath: string,
  command: string
): Promise<void> {
  try {
    await exec.exec(`"${cliPath}" ${command}`, [], {})
  } catch (error) {
    throw new Error(error)
  }
}
run()
