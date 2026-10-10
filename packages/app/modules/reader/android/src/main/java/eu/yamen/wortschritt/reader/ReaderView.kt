package eu.yamen.wortschritt.reader

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

/** A React Native view hosting the Compose reader; props become Compose state. */
class ReaderView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  // The ComposeView needs Android's own measure/layout pass inside React Native.
  override val shouldUseAndroidLayout = true

  private val onWordPress by EventDispatcher()
  private val onPageChange by EventDispatcher()
  private val onCenterTap by EventDispatcher()

  private var state by mutableStateOf(ReaderState())

  init {
    val compose = ComposeView(context).apply {
      layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
      setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnDetachedFromWindow)
      setContent {
        Reader(
          state = state,
          onWord = { word, paragraph -> onWordPress(mapOf("word" to word, "paragraph" to paragraph)) },
          onPage = { page, count -> onPageChange(mapOf("page" to page, "count" to count)) },
          onCenter = { onCenterTap(mapOf("tap" to true)) },
        )
      }
    }
    addView(compose)
  }

  fun update(change: (ReaderState) -> ReaderState) {
    state = change(state)
  }
}
