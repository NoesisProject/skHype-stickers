/**
 * maunium-stickerpicker - A fast and simple Matrix sticker picker widget.
 * Copyright (C) 2020 Tulir Asokan
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { html, render, Component } from "../lib/htm/preact.js";
import { Spinner } from "./spinner.js";
import { SearchBox } from "./search-box.js";
import { giphyIsEnabled, GiphySearchTab, setGiphyAPIKey } from "./giphy.js";
import * as widgetAPI from "./widget-api.js";
import * as frequent from "./frequently-used.js";

// Le "base URL" des packs. On charge d'abord packs/index.json, puis
// pour chaque item dans "packs", on charge packs/<fichier>.json, etc.
const PACKS_BASE_URL = "packs";

// On récupère param "?config=" ou par défaut "packs/index.json"
let INDEX = `${PACKS_BASE_URL}/index.json`;
const params = new URLSearchParams(document.location.search);
if (params.has("config")) {
  INDEX = params.get("config");
}

// (Optionnel) Homserver matrix si tu en as besoin, sinon on peut laisser comme ça
let HOMESERVER_URL = "https://matrix-client.matrix.org";

// *** MODIFICATION : on utilise thumbnail_url du sticker (si défini)
// Sinon on reconstruit l’URL à partir de sticker.url
const makeThumbnailURL = (sticker) =>
  sticker.thumbnail_url || `${PACKS_BASE_URL}/thumbnails/${sticker.url.split("/").slice(-1)[0]}`;

// Pour détecter iOS (bug de scroll)
const isMobileSafari =
  navigator.userAgent.match(/(iPod|iPhone|iPad)/) &&
  navigator.userAgent.match(/AppleWebKit/);

const supportedThemes = ["light", "dark", "black"];

// État par défaut
const defaultState = {
  packs: [],
  filtering: {
    searchTerm: "",
    packs: [],
  },
};

class App extends Component {
  constructor(props) {
    super(props);

    // Récupération du param "theme" si passé en URL
    this.defaultTheme = params.get("theme");

    this.state = {
      viewingGifs: false,
      packs: defaultState.packs,
      loading: true,
      error: null,
      stickersPerRow: parseInt(localStorage.mauStickersPerRow || "4"),
      theme: localStorage.mauStickerThemeOverride || this.defaultTheme,
      frequentlyUsed: {
        id: "frequently-used",
        title: "Frequently used",
        stickerIDs: frequent.get(),
        stickers: [],
      },
      filtering: defaultState.filtering,
    };

    // On force un thème par défaut
    if (!supportedThemes.includes(this.state.theme)) {
      this.state.theme = "light";
    }
    if (!supportedThemes.includes(this.defaultTheme)) {
      this.defaultTheme = "light";
    }

    // "stickersByID" => Map mémorisant nos stickers par ID
    this.stickersByID = new Map(
      JSON.parse(localStorage.mauFrequentlyUsedStickerCache || "[]")
    );
    this.state.frequentlyUsed.stickers = this._getStickersByID(
      this.state.frequentlyUsed.stickerIDs
    );

    // Refs et binding
    this.imageObserver = null;
    this.packListRef = null;
    this.navRef = null;

    this.searchStickers = this.searchStickers.bind(this);
    this.sendSticker = this.sendSticker.bind(this);
    this.navScroll = this.navScroll.bind(this);
    this.reloadPacks = this.reloadPacks.bind(this);
    this.observeSectionIntersections = this.observeSectionIntersections.bind(
      this
    );
    this.observeImageIntersections = this.observeImageIntersections.bind(this);
  }

  // Récupère un tableau de stickers à partir d'une liste d’IDs
  _getStickersByID(ids) {
    return ids.map((id) => this.stickersByID.get(id)).filter((st) => !!st);
  }

  // Met à jour la liste "frequently used"
  updateFrequentlyUsed() {
    const stickerIDs = frequent.get();
    const stickers = this._getStickersByID(stickerIDs);
    this.setState({
      frequentlyUsed: {
        ...this.state.frequentlyUsed,
        stickerIDs,
        stickers,
      },
    });
    // Met en cache local
    localStorage.mauFrequentlyUsedStickerCache = JSON.stringify(
      stickers.map((st) => [st.id, st])
    );
  }

  // Filtre la recherche
  searchStickers(e) {
    const sanitizeString = (s) => s.toLowerCase().trim();
    const searchTerm = sanitizeString(e.target.value);

    const allPacks = [this.state.frequentlyUsed, ...this.state.packs];
    const packsWithFilteredStickers = allPacks.map((pack) => ({
      ...pack,
      stickers: pack.stickers.filter(
        (sticker) =>
          sanitizeString(sticker.body).includes(searchTerm) ||
          sanitizeString(sticker.id).includes(searchTerm)
      ),
    }));

    this.setState({
      filtering: {
        ...this.state.filtering,
        searchTerm,
        packs: packsWithFilteredStickers.filter((p) => p.stickers.length > 0),
      },
    });
  }

  // Modifie le "nombre de stickers par rangée"
  setStickersPerRow(val) {
    localStorage.mauStickersPerRow = val;
    document.documentElement.style.setProperty(
      "--stickers-per-row",
      localStorage.mauStickersPerRow
    );
    this.setState({ stickersPerRow: val });
    this.packListRef.scrollTop = this.packListRef.scrollHeight;
  }

  // Thème
  setTheme(theme) {
    if (theme === "default") {
      delete localStorage.mauStickerThemeOverride;
      this.setState({ theme: this.defaultTheme });
    } else {
      localStorage.mauStickerThemeOverride = theme;
      this.setState({ theme });
    }
  }

  // Reload : on “reset” et on re-charge
  reloadPacks() {
    // Stop les observers
    this.imageObserver.disconnect();
    this.sectionObserver.disconnect();
    // Reset
    this.setState({
      packs: defaultState.packs,
      filtering: defaultState.filtering,
    });
    // Re-load
    this._loadPacks(true);
  }

  // Charge la liste "packs/index.json" puis pour chacun, on fetch le .json
  _loadPacks(disableCache = false) {
    const cache = disableCache ? "no-cache" : undefined;
    fetch(INDEX, { cache }).then(
      async (indexRes) => {
        if (indexRes.status >= 400) {
          this.setState({
            loading: false,
            error: indexRes.status !== 404 ? indexRes.statusText : null,
          });
          return;
        }
        const indexData = await indexRes.json();

        // Facultatif, si besoin du HS matrix
        HOMESERVER_URL = indexData.homeserver_url || HOMESERVER_URL;

        // Facultatif, si Giphy
        if (indexData.giphy_api_key !== undefined) {
          setGiphyAPIKey(indexData.giphy_api_key, indexData.giphy_mxc_prefix);
        }

        // Charger chaque pack
        for (const packFile of indexData.packs) {
          let packRes;
          if (packFile.startsWith("https://") || packFile.startsWith("http://")) {
            packRes = await fetch(packFile, { cache });
          } else {
            packRes = await fetch(`${PACKS_BASE_URL}/${packFile}`, { cache });
          }
          const packData = await packRes.json();

          // On NE remplace PAS sticker.url; on le laisse tel quel
          // On enregistre juste dans stickersByID
          for (const sticker of packData.stickers) {
            this.stickersByID.set(sticker.id, sticker);
          }

          // Puis on ajoute ce pack à la liste
          this.setState({
            packs: [...this.state.packs, packData],
            loading: false,
          });
        }

        // Mise à jour de "frequently used" après chargement
        this.updateFrequentlyUsed();
      },
      (error) => this.setState({ loading: false, error })
    );
  }

  // Une fois monté
  componentDidMount() {
    document.documentElement.style.setProperty(
      "--stickers-per-row",
      this.state.stickersPerRow.toString()
    );
    this._loadPacks();

    // On crée les observers
    this.imageObserver = new IntersectionObserver(this.observeImageIntersections, {
      rootMargin: "100px",
    });
    this.sectionObserver = new IntersectionObserver(this.observeSectionIntersections);
  }

  // Intersection observer : images
  observeImageIntersections(intersections) {
    for (const entry of intersections) {
      const img = entry.target.children.item(0);
      if (entry.isIntersecting) {
        // si l'élément est visible, on set "src" = "data-src"
        img.setAttribute("src", img.getAttribute("data-src"));
        img.classList.add("visible");
      } else {
        // sinon on retire "src"
        img.removeAttribute("src");
        img.classList.remove("visible");
      }
    }
  }

  // Intersection observer : sections (pour la barre de navigation)
  observeSectionIntersections(intersections) {
    const navWidth = this.navRef.getBoundingClientRect().width;
    let minX = 0,
      maxX = navWidth;
    let minXElem = null,
      maxXElem = null;

    for (const entry of intersections) {
      const packID = entry.target.getAttribute("data-pack-id");
      if (!packID) continue;

      const navElement = document.getElementById(`nav-${packID}`);
      if (entry.isIntersecting) {
        navElement.classList.add("visible");
        const bb = navElement.getBoundingClientRect();
        if (bb.x < minX) {
          minX = bb.x;
          minXElem = navElement;
        } else if (bb.right > maxX) {
          maxX = bb.right;
          maxXElem = navElement;
        }
      } else {
        navElement.classList.remove("visible");
      }
    }

    // Scroll horizontal, si besoin
    if (minXElem !== null) {
      minXElem.scrollIntoView({ inline: "start" });
    } else if (maxXElem !== null) {
      maxXElem.scrollIntoView({ inline: "end" });
    }
  }

  // Après chaque update
  componentDidUpdate() {
    if (this.packListRef === null) return;

    // On observe toutes les .sticker (pour images)
    for (const elem of this.packListRef.getElementsByClassName("sticker")) {
      this.imageObserver.observe(elem);
    }
    // On observe les sections (pour la nav)
    for (const elem of this.packListRef.children) {
      this.sectionObserver.observe(elem);
    }
  }

  // Avant que ça unmount
  componentWillUnmount() {
    this.imageObserver.disconnect();
    this.sectionObserver.disconnect();
  }

  // Envoi du sticker
  sendSticker(evt) {
    const id = evt.currentTarget.getAttribute("data-sticker-id");
    const sticker = this.stickersByID.get(id);

    // On note ce sticker comme "fréquemment utilisé"
    frequent.add(id);
    this.updateFrequentlyUsed();

    // On envoie via le widget API (Element)
    widgetAPI.sendSticker(sticker);
  }

  // Navigation horizontale sur la nav
  navScroll(evt) {
    this.navRef.scrollLeft += evt.deltaY;
  }

  // Rendu
  render() {
    const theme = `theme-${this.state.theme}`;
    const filterActive = !!this.state.filtering.searchTerm;
    const packs = filterActive
      ? this.state.filtering.packs
      : [this.state.frequentlyUsed, ...this.state.packs];

    // Cas : en chargement
    if (this.state.loading) {
      return html`
        <main class="spinner ${theme}">
          <${Spinner} size=${80} green />
        </main>
      `;
    }

    // Cas : erreur
    if (this.state.error) {
      return html`
        <main class="error ${theme}">
          <h1>Failed to load packs</h1>
          <p>${this.state.error}</p>
        </main>
      `;
    }

    // Cas : pas de packs du tout
    if (this.state.packs.length === 0) {
      return html`
        <main class="empty ${theme}"><h1>No packs found 😿</h1></main>
      `;
    }

    // OnClick pour le switch Giphy si on l’utilise
    const onClickOverride = this.state.viewingGifs
      ? (evt, packID) => {
          evt.preventDefault();
          this.setState({ viewingGifs: false }, () => {
            scrollToSection(null, packID);
          });
        }
      : null;

    const switchToGiphy = () =>
      this.setState({ viewingGifs: true, filtering: defaultState.filtering });

    return html`
      <main class="has-content ${theme}">
        <nav onWheel=${this.navScroll} ref=${(elem) => (this.navRef = elem)}>
          ${giphyIsEnabled() &&
          html`
            <${NavBarItem}
              pack=${{ id: "giphy", title: "GIPHY" }}
              iconOverride="giphy"
              onClickOverride=${switchToGiphy}
              extraClass=${this.state.viewingGifs ? "visible" : ""}
            />
          `}
          <${NavBarItem}
            pack=${this.state.frequentlyUsed}
            iconOverride="recent"
            onClickOverride=${onClickOverride}
          />
          ${this.state.packs.map(
            (pack) =>
              html`
                <${NavBarItem}
                  id=${pack.id}
                  pack=${pack}
                  onClickOverride=${onClickOverride}
                />
              `
          )}
          <${NavBarItem}
            pack=${{ id: "settings", title: "Settings" }}
            iconOverride="settings"
            onClickOverride=${onClickOverride}
          />
        </nav>

        ${this.state.viewingGifs
          ? html` <${GiphySearchTab} /> `
          : html`
              <${SearchBox}
                onInput=${this.searchStickers}
                value=${this.state.filtering.searchTerm ?? ""}
              />
              <div
                class="pack-list ${isMobileSafari ? "ios-safari-hack" : ""}"
                ref=${(elem) => (this.packListRef = elem)}
              >
                ${filterActive && packs.length === 0
                  ? html`
                      <div class="search-empty">
                        <h1>No stickers match your search</h1>
                      </div>
                    `
                  : null}
                ${packs.map(
                  (pack) =>
                    html`<${Pack} id=${pack.id} pack=${pack} send=${this.sendSticker} />`
                )}
                <${Settings} app=${this} />
              </div>
            `}
      </main>
    `;
  }
}

// Composant "Settings" pour régler reload, nb de colonnes, theme, ...
const Settings = ({ app }) => html`
  <section
    class="stickerpack settings"
    id="pack-settings"
    data-pack-id="settings"
  >
    <h1>Settings</h1>
    <div class="settings-list">
      <button onClick=${app.reloadPacks}>Reload</button>
      <div>
        <label for="stickers-per-row">
          Stickers per row: ${app.state.stickersPerRow}
        </label>
        <input
          type="range"
          min="2"
          max="10"
          id="stickers-per-row"
          value=${app.state.stickersPerRow}
          onInput=${(evt) => app.setStickersPerRow(evt.target.value)}
        />
      </div>
      <div>
        <label for="theme">Theme: </label>
        <select
          name="theme"
          id="theme"
          onChange=${(evt) => app.setTheme(evt.target.value)}
        >
          <option value="default">Default</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
          <option value="black">Black</option>
        </select>
      </div>
    </div>
  </section>
`;

// Scroll helper (pour iOS)
const scrollToSection = (evt, id) => {
  const pack = document.getElementById(`pack-${id}`);
  if (pack) {
    pack.scrollIntoView({ block: "start", behavior: "instant" });
  }
  evt?.preventDefault();
};

// NavBarItem => un petit bouton dans la nav, soit Giphy, soit un pack
const NavBarItem = ({ pack, iconOverride = null, onClickOverride = null, extraClass = null }) => html`
  <a
    href="#pack-${pack.id}"
    id="nav-${pack.id}"
    data-pack-id=${pack.id}
    title=${pack.title}
    class="${extraClass}"
    onClick=${
      onClickOverride
        ? (evt) => onClickOverride(evt, pack.id)
        : isMobileSafari
        ? (evt) => scrollToSection(evt, pack.id)
        : undefined
    }
  >
    <div class="sticker">
      ${
        iconOverride
          ? html`<span class="icon icon-${iconOverride}" />`
          : html`
              <img
                src=${makeThumbnailURL(pack.stickers[0])}
                alt=${pack.stickers[0].body}
                class="visible"
              />
            `
      }
    </div>
  </a>
`;

// Pack => Section affichant tous les stickers
const Pack = ({ pack, send }) => html`
  <section class="stickerpack" id="pack-${pack.id}" data-pack-id=${pack.id}>
    <h1>${pack.title}</h1>
    <div class="sticker-list">
      ${pack.stickers.map(
        (sticker) => html`<${Sticker} key=${sticker.id} content=${sticker} send=${send} />`
      )}
    </div>
  </section>
`;

// Sticker => Un bloc <div> contenant l'image (src = data-src), clic => sendSticker
const Sticker = ({ content, send }) => html`
  <div class="sticker" onClick=${send} data-sticker-id=${content.id}>
    <img data-src=${makeThumbnailURL(content)} alt=${content.body} title=${content.body} />
  </div>
`;

// On “monte” le composant principal
render(html`<${App} />`, document.body);
