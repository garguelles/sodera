package xyz.sodera.app.passkey

import android.app.Activity
import android.os.Build
import android.os.CancellationSignal
import androidx.credentials.CreateCredentialResponse
import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.CreatePublicKeyCredentialResponse
import androidx.credentials.CredentialManager
import androidx.credentials.CredentialManagerCallback
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import androidx.credentials.exceptions.CreateCredentialCancellationException
import androidx.credentials.exceptions.CreateCredentialException
import androidx.credentials.exceptions.CreateCredentialInterruptedException
import androidx.credentials.exceptions.CreateCredentialNoCreateOptionException
import androidx.credentials.exceptions.CreateCredentialProviderConfigurationException
import androidx.credentials.exceptions.CreateCredentialUnsupportedException
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.GetCredentialInterruptedException
import androidx.credentials.exceptions.GetCredentialProviderConfigurationException
import androidx.credentials.exceptions.GetCredentialUnsupportedException
import androidx.credentials.exceptions.NoCredentialException
import androidx.credentials.exceptions.publickeycredential.CreatePublicKeyCredentialDomException
import androidx.credentials.exceptions.publickeycredential.GetPublicKeyCredentialDomException
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SoderaPasskeyModule : Module() {
  private var pendingOperation: PendingOperation? = null
  private var nextOperationId = 0L

  override fun definition() = ModuleDefinition {
    Name("SoderaPasskey")

    AsyncFunction("createCredentialAsync") { requestJson: String, promise: Promise ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
        promise.resolve(errorResult("unsupported", "android-api-below-28"))
        return@AsyncFunction
      }
      val activity = foregroundActivity()
      if (activity == null) {
        promise.resolve(errorResult("canceled", "foreground-activity-unavailable"))
        return@AsyncFunction
      }
      val operation = beginOperation(promise)
      val request = try {
        CreatePublicKeyCredentialRequest(requestJson)
      } catch (_: IllegalArgumentException) {
        finish(operation.id, errorResult("domError", "invalid-create-request"))
        return@AsyncFunction
      }

      CredentialManager.create(activity).createCredentialAsync(
        activity,
        request,
        operation.cancellationSignal,
        ContextCompat.getMainExecutor(activity),
        object : CredentialManagerCallback<CreateCredentialResponse, CreateCredentialException> {
          override fun onResult(result: CreateCredentialResponse) {
            val response = result as? CreatePublicKeyCredentialResponse
            finish(
              operation.id,
              response?.let { successResult(it.registrationResponseJson) }
                ?: errorResult("unknown", "unexpected-create-response")
            )
          }

          override fun onError(error: CreateCredentialException) {
            finish(operation.id, createErrorResult(error))
          }
        }
      )
    }

    AsyncFunction("getCredentialAsync") { requestJson: String, promise: Promise ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
        promise.resolve(errorResult("unsupported", "android-api-below-28"))
        return@AsyncFunction
      }
      val activity = foregroundActivity()
      if (activity == null) {
        promise.resolve(errorResult("canceled", "foreground-activity-unavailable"))
        return@AsyncFunction
      }
      val operation = beginOperation(promise)
      val request = try {
        GetCredentialRequest(listOf(GetPublicKeyCredentialOption(requestJson)))
      } catch (_: IllegalArgumentException) {
        finish(operation.id, errorResult("domError", "invalid-get-request"))
        return@AsyncFunction
      }

      CredentialManager.create(activity).getCredentialAsync(
        activity,
        request,
        operation.cancellationSignal,
        ContextCompat.getMainExecutor(activity),
        object : CredentialManagerCallback<GetCredentialResponse, GetCredentialException> {
          override fun onResult(result: GetCredentialResponse) {
            val credential = result.credential as? PublicKeyCredential
            finish(
              operation.id,
              credential?.let { successResult(it.authenticationResponseJson) }
                ?: errorResult("unknown", "unexpected-get-response")
            )
          }

          override fun onError(error: GetCredentialException) {
            finish(operation.id, getErrorResult(error))
          }
        }
      )
    }

    Function("cancelPendingOperation") { cancelPending("caller-canceled") }
    OnActivityDestroys { cancelPending("activity-destroyed") }
    OnDestroy { cancelPending("module-destroyed") }
  }

  private fun foregroundActivity(): Activity? {
    val activity = appContext.currentActivity ?: return null
    val lifecycle = (activity as? LifecycleOwner)?.lifecycle ?: return null
    return activity.takeIf { lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED) }
  }

  private fun beginOperation(promise: Promise): PendingOperation {
    cancelPending("operation-superseded")
    return PendingOperation(++nextOperationId, CancellationSignal(), promise).also {
      pendingOperation = it
    }
  }

  private fun finish(operationId: Long, result: Map<String, Any>) {
    val operation = pendingOperation?.takeIf { it.id == operationId } ?: return
    pendingOperation = null
    operation.promise.resolve(result)
  }

  private fun cancelPending(type: String) {
    val operation = pendingOperation ?: return
    pendingOperation = null
    operation.cancellationSignal.cancel()
    operation.promise.resolve(errorResult("canceled", type))
  }

  private fun successResult(responseJson: String): Map<String, Any> = mapOf(
    "status" to "success",
    "responseJson" to responseJson
  )

  private fun errorResult(kind: String, type: String, domError: String? = null): Map<String, Any> = mapOf(
    "status" to "error",
    "error" to buildMap {
      put("kind", kind)
      put("type", type)
      domError?.let { put("domError", it) }
    }
  )

  private fun createErrorResult(error: CreateCredentialException): Map<String, Any> = when (error) {
    is CreateCredentialCancellationException -> errorResult("canceled", error.type)
    is CreateCredentialNoCreateOptionException -> errorResult("noCreateOption", error.type)
    is CreateCredentialProviderConfigurationException -> errorResult("providerConfiguration", error.type)
    is CreateCredentialUnsupportedException -> errorResult("unsupported", error.type)
    is CreateCredentialInterruptedException -> errorResult("interrupted", error.type)
    is CreatePublicKeyCredentialDomException -> errorResult("domError", error.type, error.domError.type)
    else -> errorResult("unknown", error.type)
  }

  private fun getErrorResult(error: GetCredentialException): Map<String, Any> = when (error) {
    is GetCredentialCancellationException -> errorResult("canceled", error.type)
    is NoCredentialException -> errorResult("noCredential", error.type)
    is GetCredentialProviderConfigurationException -> errorResult("providerConfiguration", error.type)
    is GetCredentialUnsupportedException -> errorResult("unsupported", error.type)
    is GetCredentialInterruptedException -> errorResult("interrupted", error.type)
    is GetPublicKeyCredentialDomException -> errorResult("domError", error.type, error.domError.type)
    else -> errorResult("unknown", error.type)
  }
}

private data class PendingOperation(
  val id: Long,
  val cancellationSignal: CancellationSignal,
  val promise: Promise
)
