/**
 * The card shown when a Hole is won: the score against Par and a button to
 * play the Hole again.
 */
export function createResultView(container: HTMLElement, onReplay: () => void) {
  const card = document.createElement("div");
  card.style.cssText =
    "position:fixed;left:50%;top:40%;transform:translate(-50%,-50%);padding:24px 36px;border-radius:12px;" +
    "background:rgba(20,24,32,0.85);color:#fff;font:600 16px system-ui,sans-serif;text-align:center;display:none";
  const title = document.createElement("div");
  title.style.cssText = "font-size:32px;margin-bottom:6px";
  const detail = document.createElement("div");
  detail.style.cssText = "opacity:0.8;margin-bottom:16px";
  const button = document.createElement("button");
  button.textContent = "Play again (R)";
  button.style.cssText = "font:inherit;padding:8px 18px;border:0;border-radius:6px;background:#f5c542;cursor:pointer";
  button.addEventListener("click", onReplay);
  card.append(title, detail, button);
  container.append(card);

  return {
    show(heading: string, text: string) {
      title.textContent = heading;
      detail.textContent = text;
      card.style.display = "block";
    },
    hide() {
      card.style.display = "none";
    },
  };
}
