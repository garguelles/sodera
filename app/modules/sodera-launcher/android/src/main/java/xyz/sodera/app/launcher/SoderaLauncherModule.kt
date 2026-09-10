package xyz.sodera.app.launcher

import android.content.ActivityNotFoundException
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.drawable.Drawable
import android.os.Build
import android.util.Base64
import android.util.LruCache
import androidx.core.graphics.drawable.toBitmap
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream
import java.util.Locale

class SoderaLauncherModule : Module() {
  private var receiverRegistered = false
  private val iconCache = LruCache<String, String>(ICON_CACHE_SIZE)

  private val packageReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      iconCache.evictAll()
      sendEvent(
        "onAppsChanged",
        mapOf(
          "action" to intent.action,
          "packageName" to intent.data?.schemeSpecificPart,
          "replacing" to intent.getBooleanExtra(Intent.EXTRA_REPLACING, false)
        )
      )
    }
  }

  override fun definition() = ModuleDefinition {
    Name("SoderaLauncher")

    Events("onAppsChanged")

    AsyncFunction("getLaunchableAppsAsync") {
      getLaunchableApps()
    }

    AsyncFunction("launchAppAsync") { serializedComponent: String ->
      launchApp(serializedComponent)
    }

    OnStartObserving("onAppsChanged") {
      registerPackageReceiver()
    }

    OnStopObserving("onAppsChanged") {
      unregisterPackageReceiver()
    }

    OnDestroy {
      unregisterPackageReceiver()
    }
  }

  private fun getLaunchableApps(): List<Map<String, Any?>> {
    val context = requireContext()
    val packageManager = context.packageManager
    val launcherIntent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
    val activities = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      packageManager.queryIntentActivities(
        launcherIntent,
        PackageManager.ResolveInfoFlags.of(0L)
      )
    } else {
      @Suppress("DEPRECATION")
      packageManager.queryIntentActivities(launcherIntent, 0)
    }

    return activities.asSequence()
      .filter { it.activityInfo.enabled && it.activityInfo.packageName != context.packageName }
      .distinctBy {
        ComponentName(it.activityInfo.packageName, it.activityInfo.name).flattenToString()
      }
      .map { resolveInfo ->
        val activity = resolveInfo.activityInfo
        val componentName = ComponentName(activity.packageName, activity.name).flattenToString()
        mapOf(
          "componentName" to componentName,
          "packageName" to activity.packageName,
          "label" to runCatching { resolveInfo.loadLabel(packageManager).toString() }
            .getOrDefault(activity.packageName),
          "icon" to (
            iconCache[componentName]
              ?: runCatching { encodeIcon(resolveInfo.loadIcon(packageManager)) }
                .getOrNull()
                ?.also { iconCache.put(componentName, it) }
          )
        )
      }
      .sortedBy { (it["label"] as String).lowercase(Locale.getDefault()) }
      .toList()
  }

  private fun launchApp(serializedComponent: String) {
    val component = ComponentName.unflattenFromString(serializedComponent)
      ?: throw InvalidComponentException()
    val intent = Intent(Intent.ACTION_MAIN)
      .addCategory(Intent.CATEGORY_LAUNCHER)
      .setComponent(component)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    try {
      requireContext().startActivity(intent)
    } catch (error: ActivityNotFoundException) {
      throw AppUnavailableException(error)
    } catch (error: SecurityException) {
      throw AppUnavailableException(error)
    }
  }

  private fun registerPackageReceiver() {
    if (receiverRegistered) return
    val filter = IntentFilter().apply {
      addAction(Intent.ACTION_PACKAGE_ADDED)
      addAction(Intent.ACTION_PACKAGE_REMOVED)
      addAction(Intent.ACTION_PACKAGE_CHANGED)
      addDataScheme("package")
    }
    val context = requireContext()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      context.registerReceiver(packageReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      @Suppress("DEPRECATION")
      context.registerReceiver(packageReceiver, filter)
    }
    receiverRegistered = true
  }

  private fun unregisterPackageReceiver() {
    if (!receiverRegistered) return
    runCatching { requireContext().unregisterReceiver(packageReceiver) }
    receiverRegistered = false
  }

  private fun requireContext(): Context = appContext.reactContext
    ?: throw LauncherUnavailableException()

  private fun encodeIcon(drawable: Drawable): String {
    val bitmap = drawable.toBitmap(width = ICON_SIZE, height = ICON_SIZE, config = Bitmap.Config.ARGB_8888)
    val bytes = ByteArrayOutputStream().use { output ->
      bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)
      output.toByteArray()
    }
    return "data:image/png;base64,${Base64.encodeToString(bytes, Base64.NO_WRAP)}"
  }

  companion object {
    private const val ICON_SIZE = 96
    private const val ICON_CACHE_SIZE = 128
  }
}

private class InvalidComponentException : CodedException("Invalid app component")
private class AppUnavailableException(cause: Throwable) :
  CodedException("App is no longer available", cause)
private class LauncherUnavailableException : CodedException("Launcher is unavailable")
