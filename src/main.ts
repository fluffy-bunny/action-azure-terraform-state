import * as core from '@actions/core'
import * as crypto from 'crypto'
import * as exec from '@actions/exec'
import * as io from '@actions/io'
import {ExecOptions} from '@actions/exec/lib/interfaces'

let azPath: string
const prefix = process.env.AZURE_HTTP_USER_AGENT
  ? `${process.env.AZURE_HTTP_USER_AGENT}`
  : ''

const shortNameLower = 6
const shortNameUpper = 13

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
    await executeAzCliCommand('--version', false)
    await executeAzCliCommand('account show', false)
    const subscriptionId = await executeAzCliCommandWithReturn(
      'account show --query id -o tsv',
      false
    )
    core.info(`subscriptionId: ${subscriptionId}`)

    const shortName: string = core.getInput('shortName')
    core.info(`shortName: ${shortName}`)

    if (
      shortName.length < shortNameLower ||
      shortName.length > shortNameUpper
    ) {
      const error = `shortName:"${shortName}" must be of length [${shortNameLower}-${shortNameUpper}]`
      throw error
    }
    const location: string = core.getInput('location')
    core.info(`location: ${location}`)

    const resourceGroupName = `rg-terraform-${shortName}`
    const storageAccountName = `stterraform${shortName}`
    const keyVaultName = `kv-tf-${shortName}`
    const containerName = 'tstate'

    core.info(`resourceGroupName: ${resourceGroupName}`)
    core.info(`storageAccountName: ${storageAccountName}`)
    core.info(`keyVaultName: ${keyVaultName}`)

    /*
      Create the Resource Group
    */
    core.info(
      `==== Creating Resource Group: ${resourceGroupName} in Location: ${location} ====`
    )
    await executeAzCliCommand(
      `group create --name ${resourceGroupName} --location ${location}`,
      false
    )
    let exists = await executeAzCliCommandWithReturn(
      `group exists -n ${resourceGroupName} --subscription ${subscriptionId}`,
      false
    )
    if (exists === 'false') {
      const error = `resourceGroupName:"${resourceGroupName}" create failed!`
      throw error
    }

    /*
      Create the Storage Account
    */
    core.info(
      `==== Creating Storage Account: ${storageAccountName} in Location: ${location} ====`
    )
    await executeAzCliCommand(
      `storage account create --name ${storageAccountName} --resource-group ${resourceGroupName} --location ${location} --encryption-services blob --sku Standard_LRS`,
      false
    )
    core.info(
      `==== Fetch Storage Account Key: ${storageAccountName} in Location: ${location} ====`
    )
    const storageAccountKey = await executeAzCliCommandWithReturn(
      `storage account keys list --resource-group ${resourceGroupName} --account-name ${storageAccountName} --query [0].value -o tsv`,
      true
    )

    /*
      Create the Storage Account Container
    */
    core.info(
      `==== Creating Container: ${containerName} in Storage Account: ${storageAccountName} in Location: ${location} ====`
    )
    await executeAzCliCommand(
      `storage container create --name ${containerName} --account-name ${storageAccountName} --account-key ${storageAccountKey}`,
      false
    )
    exists = await executeAzCliCommandWithReturn(
      `storage container exists --account-name ${storageAccountName} --account-key ${storageAccountKey} --name ${containerName}`,
      false
    )
    if (exists === 'false') {
      const error = `container:"${containerName}" create failed!`
      throw error
    }

    /*
      Create the Key Vault
    */
    core.info(
      `==== Creating KeyVault: ${keyVaultName} in Location: ${location} ====`
    )
    await executeAzCliCommand(
      `keyvault create --name ${keyVaultName} --resource-group ${resourceGroupName} --location ${location}`,
      false
    )

    /*
      Store terraform-backend-key as KeyVault Secret
    */
    const secretName = 'terraform-backend-key'
    const jsonSecretResponse = await executeAzCliCommandWithReturn(
      `keyvault secret set -n ${secretName} --value ${storageAccountKey} --vault-name ${keyVaultName}`,
      false
    )
    const secretResponse = JSON.parse(jsonSecretResponse)
    core.info(`secretId: ${secretResponse.id}`)

    const exportArmAccessKey = `export ARM_ACCESS_KEY=$(az keyvault secret show --name '${secretName}' --vault-name '${keyVaultName}' --query value -o tsv)`
    core.info(`exportArmAccessKey: ${exportArmAccessKey}`)
    core.setOutput('exportArmAccessKey', exportArmAccessKey)
    core.setOutput('storageAccount', storageAccountName)
    core.setOutput('container', containerName)
    core.setOutput('keyVault', keyVaultName)
    core.setOutput('resourceGroup', resourceGroupName)
  } catch (error) {
    core.setFailed(error.message)
  }
}
async function executeAzCliCommandWithReturn(
  command: string,
  stdoutSilent: boolean
): Promise<string> {
  try {
    return await executeCliCommandWithReturn(azPath, command, stdoutSilent)
  } catch (error) {
    throw new Error(error)
  }
}
async function executeCliCommandWithReturn(
  cliPath: string,
  command: string,
  stdoutSilent: boolean
): Promise<string> {
  try {
    let myOutput = ''
    let myError = ''

    const options: ExecOptions = {
      silent: true,
      listeners: {
        stdout: (data: Buffer) => {
          if (!stdoutSilent) {
            process.stdout.write(data)
          }
          myOutput += data.toString()
        },
        stderr: (data: Buffer) => {
          if (!stdoutSilent) {
            process.stderr.write(data)
          }
          myError += data.toString()
        }
      }
    }

    await exec.exec(`"${cliPath}" ${command}`, [], options)
    if (myError.length > 0) {
      throw new Error(myError)
    }
    return myOutput
  } catch (error) {
    throw new Error(error)
  }
}

async function executeAzCliCommand(
  command: string,
  stdoutSilent: boolean
): Promise<void> {
  try {
    await executeCliCommand(azPath, command, stdoutSilent)
  } catch (error) {
    throw new Error(error)
  }
}

async function executeCliCommand(
  cliPath: string,
  command: string,
  stdoutSilent: boolean
): Promise<void> {
  try {
    const options: ExecOptions = {
      silent: true
    }
    if (!stdoutSilent) {
      options.listeners = {
        stdout: (data: Buffer) => {
          process.stdout.write(data)
        }
      }
    }
    await exec.exec(`"${cliPath}" ${command}`, [], options)
  } catch (error) {
    throw new Error(error)
  }
}
run()
