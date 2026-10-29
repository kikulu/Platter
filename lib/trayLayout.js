'use strict';

/**
 * lib/trayLayout.js
 *
 * 右下角浮動托盤的位置計算（純函式，不依賴 Electron，可以直接用 node --test 測試）。
 *
 * 托盤位置用「收起圓鈕」相對於容器（主視窗內容區 ∩ 螢幕工作區）右下角的距離
 * `{ right, bottom }` 描述，預設就是右下角留一點邊距。這樣主視窗移動／縮放時，
 * 托盤會維持在同一個相對位置；使用者拖到別處後也一樣會跟著主視窗走。
 *
 * 展開面板以圓鈕為錨點：圓鈕在容器右半邊就往左長、在左半邊就往右長；
 * 在下半邊往上長、在上半邊往下長，最後再夾回容器內，不會長到視窗／螢幕外面。
 */

const TRAY_MARGIN = 16;
const TRAY_COLLAPSED_SIZE = 56;
const TRAY_EXPANDED_WIDTH = 340;
const TRAY_EXPANDED_HEIGHT = 440;

function clamp(v, lo, hi) {
  return Math.min(Math.max(v, lo), Math.max(lo, hi));
}

function defaultPosition() {
  return { right: TRAY_MARGIN, bottom: TRAY_MARGIN };
}

/** 兩個矩形的交集；沒有交集回傳 null。 */
function intersectRects(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/** 圓鈕（收起狀態）的矩形。position 為 null 就用預設右下角。 */
function collapsedRect(container, position) {
  const pos = position || defaultPosition();
  const size = TRAY_COLLAPSED_SIZE;
  const x = container.x + container.width - size - pos.right;
  const y = container.y + container.height - size - pos.bottom;
  return {
    x: Math.round(clamp(x, container.x, container.x + container.width - size)),
    y: Math.round(clamp(y, container.y, container.y + container.height - size)),
    width: size,
    height: size,
  };
}

/** 托盤視窗目前該有的 bounds（收起＝圓鈕，展開＝面板）。 */
function computeTrayBounds(container, position, expanded) {
  const btn = collapsedRect(container, position);
  if (!expanded) return btn;

  const width = Math.min(TRAY_EXPANDED_WIDTH, container.width);
  const height = Math.min(TRAY_EXPANDED_HEIGHT, container.height);
  const growLeft = btn.x + btn.width / 2 > container.x + container.width / 2;
  const growUp = btn.y + btn.height / 2 > container.y + container.height / 2;
  const x = growLeft ? btn.x + btn.width - width : btn.x;
  const y = growUp ? btn.y + btn.height - height : btn.y;
  return {
    x: Math.round(clamp(x, container.x, container.x + container.width - width)),
    y: Math.round(clamp(y, container.y, container.y + container.height - height)),
    width,
    height,
  };
}

/**
 * 由托盤視窗目前的 bounds 反推要存起來的 position（拖曳結束時用）。
 * 展開狀態時圓鈕位於面板離容器中心較遠的那個角落（跟 computeTrayBounds 的展開方向一致）。
 */
function positionFromBounds(container, bounds, expanded) {
  const maxRight = Math.max(0, container.width - TRAY_COLLAPSED_SIZE);
  const maxBottom = Math.max(0, container.height - TRAY_COLLAPSED_SIZE);
  const toPosition = (btnX, btnY) => ({
    right: Math.round(
      clamp(container.x + container.width - TRAY_COLLAPSED_SIZE - btnX, 0, maxRight)
    ),
    bottom: Math.round(
      clamp(container.y + container.height - TRAY_COLLAPSED_SIZE - btnY, 0, maxBottom)
    ),
  });
  if (!expanded) return toPosition(bounds.x, bounds.y);

  // 展開時圓鈕在面板的四個角落之一：逐一試，挑「用該位置重新計算出的展開面板」
  // 跟目前 bounds 相符的那個（跟 computeTrayBounds 的展開方向規則完全一致）。
  const right = bounds.x + bounds.width - TRAY_COLLAPSED_SIZE;
  const bottom = bounds.y + bounds.height - TRAY_COLLAPSED_SIZE;
  const corners = [
    [right, bottom],
    [bounds.x, bottom],
    [right, bounds.y],
    [bounds.x, bounds.y],
  ];
  let best = null;
  let bestDiff = Infinity;
  for (const [bx, by] of corners) {
    const pos = toPosition(bx, by);
    const b = computeTrayBounds(container, pos, true);
    const diff = Math.abs(b.x - bounds.x) + Math.abs(b.y - bounds.y);
    if (diff < bestDiff) {
      best = pos;
      bestDiff = diff;
    }
  }
  return best;
}

/** 拖曳中：把視窗左上角夾在容器內（大小不變）。 */
function clampBoundsToContainer(container, bounds) {
  return {
    x: Math.round(clamp(bounds.x, container.x, container.x + container.width - bounds.width)),
    y: Math.round(clamp(bounds.y, container.y, container.y + container.height - bounds.height)),
    width: bounds.width,
    height: bounds.height,
  };
}

module.exports = {
  TRAY_MARGIN,
  TRAY_COLLAPSED_SIZE,
  TRAY_EXPANDED_WIDTH,
  TRAY_EXPANDED_HEIGHT,
  defaultPosition,
  intersectRects,
  collapsedRect,
  computeTrayBounds,
  positionFromBounds,
  clampBoundsToContainer,
};
