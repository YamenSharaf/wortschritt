package eu.yamen.wortschritt.reader

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.abs

/** Everything the reader shows, set from JS props. */
data class ReaderState(
  val title: String = "",
  val paragraphs: List<String> = emptyList(),
  val pages: Boolean = true,
  val fontSize: Float = 19f,
  val lineHeight: Float = 1.6f,
  val serif: Boolean = true,
  val fg: Int = 0xFF1E293B.toInt(),
  val bg: Int = 0xFFFFFFFF.toInt(),
)

/** A run of text with its style: the title (index -1) or a paragraph. */
private data class Block(val index: Int, val text: String, val style: TextStyle, val spacingAfter: Dp)

/** The part of a block on one page, as character offsets. */
private data class Segment(val block: Block, val start: Int, val end: Int, val endsBlock: Boolean)

private val PAGE_H_PAD = 24.dp
private val PAGE_V_PAD = 28.dp

@Composable
fun Reader(state: ReaderState, onWord: (String, Int) -> Unit, onPage: (Int, Int) -> Unit, onCenter: () -> Unit) {
  val blocks = remember(state) { blocksOf(state) }
  val word by rememberUpdatedState(onWord)
  val center by rememberUpdatedState(onCenter)
  if (state.pages) {
    PagedReader(state, blocks, { w, p -> word(w, p) }, onPage) { center() }
  } else {
    LazyColumn(
      modifier = Modifier.fillMaxSize().background(Color(state.bg)),
      contentPadding = PaddingValues(horizontal = PAGE_H_PAD, vertical = 32.dp),
    ) {
      items(blocks) { b ->
        TappableText(b.index, b.text, b.style, onWord = { w, p -> word(w, p) }, onMiss = { center() })
        Spacer(Modifier.height(b.spacingAfter))
      }
    }
  }
}

private fun blocksOf(s: ReaderState): List<Block> {
  val body = TextStyle(
    color = Color(s.fg),
    fontSize = s.fontSize.sp,
    lineHeight = (s.fontSize * s.lineHeight).sp,
    fontFamily = if (s.serif) FontFamily.Serif else FontFamily.SansSerif,
  )
  val title = body.copy(
    fontSize = (s.fontSize * 1.45f).sp,
    lineHeight = (s.fontSize * 1.45f * 1.25f).sp,
    fontWeight = FontWeight.SemiBold,
  )
  val gap = (s.fontSize * 0.9f).dp
  val out = mutableListOf<Block>()
  if (s.title.isNotEmpty()) out.add(Block(-1, s.title, title, gap * 1.2f))
  s.paragraphs.forEachIndexed { i, p -> out.add(Block(i, p, body, gap)) }
  return out
}

/**
 * Pages: every block measured at the page's width, its lines packed into
 * pages of the page's height (a paragraph may run onto the next page). A
 * page turns at once (no animation: e-ink friendly) by tapping the outer
 * quarters or swiping; a tap on a word looks it up, anywhere on the page.
 */
@Composable
private fun PagedReader(
  state: ReaderState,
  blocks: List<Block>,
  onWord: (String, Int) -> Unit,
  onPage: (Int, Int) -> Unit,
  onCenter: () -> Unit,
) {
  BoxWithConstraints(Modifier.fillMaxSize().background(Color(state.bg))) {
    val density = LocalDensity.current
    val widthPx = with(density) { (maxWidth - PAGE_H_PAD * 2).roundToPx() }.coerceAtLeast(1)
    val heightPx = with(density) { (maxHeight - PAGE_V_PAD * 2).roundToPx() }.coerceAtLeast(1)
    val fullWidthPx = with(density) { maxWidth.toPx() }
    val hPadPx = with(density) { PAGE_H_PAD.toPx() }
    val measurer = rememberTextMeasurer()
    val pages = remember(blocks, widthPx, heightPx) { paginate(measurer, blocks, widthPx, heightPx, density) }
    var page by remember(pages) { mutableIntStateOf(0) }
    val report by rememberUpdatedState(onPage)
    LaunchedEffect(page, pages.size) { report(page, pages.size) }

    val turn = { delta: Int -> page = (page + delta).coerceIn(0, pages.size - 1) }
    // A tap that isn't on a word: outer quarters turn, the middle is for the app's bars.
    val tapAt = { x: Float ->
      when {
        x < fullWidthPx * 0.25f -> turn(-1)
        x > fullWidthPx * 0.75f -> turn(1)
        else -> onCenter()
      }
    }
    var dragged by remember { mutableStateOf(0f) }

    Column(
      Modifier
        .fillMaxSize()
        .pointerInput(pages) {
          detectHorizontalDragGestures(
            onDragStart = { dragged = 0f },
            onDragEnd = { if (abs(dragged) > 60f) turn(if (dragged < 0) 1 else -1) },
          ) { change, dx ->
            dragged += dx
            change.consume()
          }
        }
        .pointerInput(pages) { detectTapGestures { pos -> tapAt(pos.x) } }
        .padding(horizontal = PAGE_H_PAD, vertical = PAGE_V_PAD),
    ) {
      for (seg in pages[page]) {
        TappableText(
          seg.block.index,
          seg.block.text.substring(seg.start, seg.end).trimEnd(),
          seg.block.style,
          onWord = onWord,
          onMiss = { pos -> tapAt(pos.x + hPadPx) },
        )
        if (seg.endsBlock) Spacer(Modifier.height(seg.block.spacingAfter))
      }
    }
  }
}

private fun paginate(measurer: TextMeasurer, blocks: List<Block>, width: Int, height: Int, density: Density): List<List<Segment>> {
  val pages = mutableListOf<List<Segment>>()
  var current = mutableListOf<Segment>()
  var used = 0f
  for (b in blocks) {
    val r = measurer.measure(AnnotatedString(b.text), b.style, constraints = Constraints(maxWidth = width))
    var line = 0
    while (line < r.lineCount) {
      var last = line
      while (last < r.lineCount && r.getLineBottom(last) - r.getLineTop(line) <= height - used) last++
      if (last == line) {
        if (current.isEmpty()) {
          last = line + 1 // a line taller than a page: it goes on a page of its own
        } else {
          pages.add(current)
          current = mutableListOf()
          used = 0f
          continue
        }
      }
      current.add(Segment(b, r.getLineStart(line), r.getLineEnd(last - 1), endsBlock = last == r.lineCount))
      used += r.getLineBottom(last - 1) - r.getLineTop(line)
      line = last
      if (line < r.lineCount) {
        pages.add(current)
        current = mutableListOf()
        used = 0f
      }
    }
    used += with(density) { b.spacingAfter.toPx() }
  }
  if (current.isNotEmpty()) pages.add(current)
  return if (pages.isEmpty()) listOf(emptyList()) else pages
}

/** Text whose words can be tapped; `onMiss` gets taps beside them (local position). */
@Composable
private fun TappableText(
  index: Int,
  text: String,
  style: TextStyle,
  onWord: (String, Int) -> Unit,
  onMiss: (Offset) -> Unit,
) {
  var layout by remember { mutableStateOf<TextLayoutResult?>(null) }
  BasicText(
    text = text,
    style = style,
    onTextLayout = { layout = it },
    modifier = Modifier
      .fillMaxWidth()
      .pointerInput(text, index) {
        detectTapGestures { pos ->
          val w = layout?.let { hitWord(it, text, pos) }
          if (w != null) onWord(w, index) else onMiss(pos)
        }
      },
  )
}

/** The word under `pos`, if the tap is on one (not in the gap beside it). */
internal fun hitWord(layout: TextLayoutResult, text: String, pos: Offset): String? {
  if (text.isEmpty()) return null
  val offset = layout.getOffsetForPosition(pos)
  for (i in intArrayOf(offset, offset - 1)) {
    if (i < 0 || i >= text.length || !text[i].isLetter()) continue
    val box = layout.getBoundingBox(i)
    if (pos.x >= box.left - 6f && pos.x <= box.right + 6f && pos.y >= box.top && pos.y <= box.bottom) {
      return wordAt(text, i)
    }
  }
  return null
}

/** The word around character `i`: letters, with hyphens inside a word. */
internal fun wordAt(text: String, i: Int): String {
  fun inWord(k: Int): Boolean =
    k in text.indices && (text[k].isLetter() || (text[k] == '-' && k > 0 && k + 1 < text.length && text[k - 1].isLetter() && text[k + 1].isLetter()))
  var start = i
  while (inWord(start - 1)) start--
  var end = i + 1
  while (inWord(end)) end++
  return text.substring(start, end)
}
