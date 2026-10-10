package eu.yamen.wortschritt.reader

import android.graphics.Color
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The Compose reader for the reader spike (issue #2, phase 1): the story's
 * text laid out, paged and hit-tested natively. JS gives it the text and the
 * look; it reports taps on words, page changes and taps in the middle.
 */
class ReaderModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WortschrittReader")

    View(ReaderView::class) {
      Events("onWordPress", "onPageChange", "onCenterTap")

      Prop("storyTitle") { view: ReaderView, value: String ->
        view.update { it.copy(title = value) }
      }
      Prop("paragraphs") { view: ReaderView, value: List<String> ->
        view.update { it.copy(paragraphs = value) }
      }
      Prop("mode") { view: ReaderView, value: String ->
        view.update { it.copy(pages = value != "scroll") }
      }
      Prop("fontSize") { view: ReaderView, value: Double ->
        view.update { it.copy(fontSize = value.toFloat()) }
      }
      Prop("lineHeight") { view: ReaderView, value: Double ->
        view.update { it.copy(lineHeight = value.toFloat()) }
      }
      Prop("serif") { view: ReaderView, value: Boolean ->
        view.update { it.copy(serif = value) }
      }
      Prop("textColor") { view: ReaderView, value: String ->
        view.update { it.copy(fg = Color.parseColor(value)) }
      }
      Prop("pageColor") { view: ReaderView, value: String ->
        view.update { it.copy(bg = Color.parseColor(value)) }
      }
    }
  }
}
