import type { RoomInfoMessage } from "../../server/types.js";

export interface RoomInfoBarAPI {
  update(info: RoomInfoMessage): void;
  getElement(): HTMLElement;
}

export function setupRoomInfoBar(): RoomInfoBarAPI {
  const bar = document.getElementById("room-info-bar")!;

  // Container for room info (left side), separate from login (right side)
  const infoSection = document.createElement("div");
  infoSection.style.cssText = "display:flex;align-items:center;gap:10px;";
  bar.appendChild(infoSection);

  function update(info: RoomInfoMessage): void {
    infoSection.textContent = "";
    bar.classList.add("visible");

    const name = document.createElement("span");
    name.className = "rib-name";
    name.textContent = info.name;
    infoSection.appendChild(name);

    if (info.description) {
      const desc = document.createElement("span");
      desc.className = "rib-desc";
      desc.textContent = info.description;
      infoSection.appendChild(desc);
    }

    infoSection.appendChild(createSep());

    const idWrap = document.createElement("span");
    idWrap.className = "rib-id";
    idWrap.textContent = `ID: ${info.roomId}`;

    const copyBtn = document.createElement("button");
    copyBtn.className = "rib-copy";
    copyBtn.textContent = "Copy";
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(info.roomId).then(() => {
        copyBtn.textContent = "Copied!";
        setTimeout(() => { copyBtn.textContent = "Copy"; }, 1500);
      });
    });
    idWrap.appendChild(copyBtn);
    infoSection.appendChild(idWrap);

    infoSection.appendChild(createSep());

    const agents = document.createElement("span");
    agents.className = "rib-agents";
    agents.textContent = `${info.agents}/${info.maxAgents} agents`;
    infoSection.appendChild(agents);
  }

  function createSep(): HTMLSpanElement {
    const sep = document.createElement("span");
    sep.className = "rib-sep";
    sep.textContent = "|";
    return sep;
  }

  return { update, getElement: () => bar };
}
