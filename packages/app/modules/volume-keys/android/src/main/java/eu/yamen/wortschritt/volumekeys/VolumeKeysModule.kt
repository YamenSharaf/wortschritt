package eu.yamen.wortschritt.volumekeys

import android.view.KeyEvent
import android.view.Window
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * While enabled (the reader is open and the learner turned the option on),
 * the volume keys come to JavaScript as "up" / "down" and don't change the
 * volume. It wraps the activity window's callback, so key events are seen
 * before anything else, and puts the original back when disabled; dialogs
 * (React Native's Modal) have their own window, so the keys work normally
 * there, as everywhere outside the reader.
 */
class VolumeKeysModule : Module() {
  private var window: Window? = null
  private var original: Window.Callback? = null

  override fun definition() = ModuleDefinition {
    Name("WortschrittVolumeKeys")

    Events("onVolumeKey")

    AsyncFunction("setEnabled") { enabled: Boolean ->
      if (enabled) enable() else disable()
    }.runOnQueue(Queues.MAIN)

    OnActivityDestroys {
      disable()
    }
  }

  private fun enable() {
    val w = appContext.currentActivity?.window ?: return
    if (w === window) return
    disable()
    val base = w.callback ?: return
    w.callback = Interceptor(base)
    window = w
    original = base
  }

  private fun disable() {
    val w = window ?: return
    if (w.callback is Interceptor) w.callback = original
    window = null
    original = null
  }

  private inner class Interceptor(private val base: Window.Callback) : Window.Callback by base {
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
      val code = event.keyCode
      if (code != KeyEvent.KEYCODE_VOLUME_UP && code != KeyEvent.KEYCODE_VOLUME_DOWN) {
        return base.dispatchKeyEvent(event)
      }
      if (event.action == KeyEvent.ACTION_DOWN) {
        sendEvent(
          "onVolumeKey",
          mapOf(
            "key" to if (code == KeyEvent.KEYCODE_VOLUME_UP) "up" else "down",
            "repeat" to (event.repeatCount > 0),
          ),
        )
      }
      // Down and up both consumed: the volume stays as it is.
      return true
    }
  }
}
