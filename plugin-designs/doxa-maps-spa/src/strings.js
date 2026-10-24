/**
 * strings.js — the Research Gallery's own words, in the 11 shipped locales.
 *
 * PRIVATE TO THIS PLUGIN, on purpose. These ~25 strings belong to the gallery shell alone (its rail,
 * sections and status hints), so they live in this folder rather than in library/i18n, whose engine
 * inlines every namespace into every bundle. Each nested map translates ITSELF; this only covers the
 * chrome around them.
 *
 * VOCABULARY FOLLOWS THE LIBRARY. Where a term already has a shipped translation it is reused verbatim,
 * so the rail row and the map it opens use the same words: legend.title.prayer (Prayer Progress),
 * legend.title.gospelResources (Gospel Resources), tabs.regions / tabs.countries, tabs.upg100Zone
 * (UPG-100), and tabs.group for "people group" (Pueblo, Peuple, Volksgruppe, …).
 *
 * `en` is the source and the fallback: a key missing in a locale renders in English rather than as a
 * key name. {n} and {label} are the only placeholders.
 */
export const STRINGS = {
  en: {
    backToTop: 'Back to top',
    'sec.dashboards': 'Dashboards', 'sec.prayer': 'Prayer Mobilization', 'sec.gospel': 'Gospel Research', 'sec.experimental': 'Experimental',
    'tab.dashboard-plus-grid': 'Big Picture', 'sub.dashboard-plus-grid': 'dashboard + people-groups grid, stacked',
    'tab.research-map': 'Research Map', 'sub.research-map': 'prayer · engagement · regions',
    'tab.research-map-plus-grid': 'Simple Research', 'sub.research-map-plus-grid': 'research map + people-groups grid',
    'tab.prayer-map': 'Prayer Progress', 'sub.prayer-map': 'simple world prayer map',
    'tab.cities-internet': 'Cities with Internet', 'sub.cities-internet': 'connectivity of key cities',
    'tab.gospel-resources': 'Gospel Resources', 'sub.gospel-resources': 'resources by place',
    'tab.regions-dashboard': 'Regions', 'sub.regions-dashboard': 'regions and their countries',
    'tab.upg-100': "UPG100 Posters", 'sub.upg-100': 'my unreached list + posters',
    navLabel: 'Research maps', meta: '{n} maps', loading: 'Loading {label}…', loadFailed: 'Could not load {label}.',
    manifestHint: 'This tab is composed from manifest.json — build the tree, or serve the built tree, to load it.',
    close: 'Close', help: 'About this map', desktopOnly: 'desktop only', lab: 'lab', experimentalSub: 'experimental bundle',
    mobileNotBuilt: 'not built for mobile', dismiss: 'Dismiss', desktopOnly: 'desktop only', lab: 'lab', experimentalSub: 'experimental bundle',
    // The shared VerticalTabsLayout's own controls, VERBATIM from library/i18n/locales/en/studio.json
    // (plugin studio's catalog) so both shells name the same buttons the same way.
    toggleList: "Toggle list", openViews: "Open the list of views", expandList: "Expand list", collapseList: "Collapse list", collapse: "Collapse", home: "Back to homepage",
    // Experimental bundles known today (rail-length names; a bundle not listed keeps its manifest title).
    'tab.prayer-walk-planner': "Prayer Walk Planner", 'tab.upg-neighbor': "UPG Neighbor", 'tab.key-cities': "Key Cities", 'tab.all-people-groups': "All People Groups", 'tab.pplr-data-maps': "PPLR Data Maps", 'tab.wall-of-people-groups': "Wall of People Groups", 'tab.bless-india-posters': "Bless India Posters", 'tab.gospel-internet': "Gospel × Internet", 'tab.country-posters': "Country Posters", 'sub.country-posters': "a poster for every country", 'tab.poster-design': "Poster Design", 'sub.poster-design': "every poster style and size", 'tab.doxa-vision-card': "Doxa Vision Card",
  },
  es: {
    backToTop: 'Volver arriba',
    'sec.dashboards': 'Paneles', 'sec.prayer': 'Movilización de oración', 'sec.gospel': 'Investigación del Evangelio', 'sec.experimental': 'Experimental',
    'tab.dashboard-plus-grid': 'Panorama general', 'sub.dashboard-plus-grid': 'panel + cuadrícula de pueblos',
    'tab.research-map': 'Mapa de investigación', 'sub.research-map': 'oración · compromiso · regiones',
    'tab.research-map-plus-grid': 'Investigación simple', 'sub.research-map-plus-grid': 'mapa de investigación + cuadrícula de pueblos',
    'tab.prayer-map': 'Progreso de oración', 'sub.prayer-map': 'mapa mundial de oración',
    'tab.cities-internet': 'Ciudades con Internet', 'sub.cities-internet': 'conectividad de ciudades clave',
    'tab.gospel-resources': 'Recursos del Evangelio', 'sub.gospel-resources': 'recursos por lugar',
    'tab.regions-dashboard': 'Regiones', 'sub.regions-dashboard': 'regiones y sus países',
    'tab.upg-100': "Carteles UPG100", 'sub.upg-100': 'mi lista de no alcanzados + carteles',
    navLabel: 'Mapas de investigación', meta: '{n} mapas', loading: 'Cargando {label}…', loadFailed: 'No se pudo cargar {label}.',
    manifestHint: 'Esta pestaña se compone a partir de manifest.json: compila el árbol o sirve el árbol compilado para cargarla.',
    close: 'Cerrar', help: 'Acerca de este mapa', desktopOnly: 'solo escritorio', lab: 'beta', experimentalSub: 'mapa experimental',
    mobileNotBuilt: 'no diseñado para móvil', dismiss: 'Cerrar', desktopOnly: 'solo escritorio', lab: 'beta', experimentalSub: 'mapa experimental',
    // The shared VerticalTabsLayout's own controls, VERBATIM from library/i18n/locales/es/studio.json
    // (plugin studio's catalog) so both shells name the same buttons the same way.
    toggleList: "Mostrar u ocultar la lista", openViews: "Abrir la lista de vistas", expandList: "Expandir la lista", collapseList: "Contraer la lista", collapse: "Contraer", home: "Volver a la página de inicio",
    // Experimental bundles known today (rail-length names; a bundle not listed keeps its manifest title).
    'tab.prayer-walk-planner': "Caminatas de oración", 'tab.upg-neighbor': "Vecino UPG", 'tab.key-cities': "Ciudades clave", 'tab.all-people-groups': "Todos los pueblos", 'tab.pplr-data-maps': "Mapas de datos PPLR", 'tab.wall-of-people-groups': "Muro de los pueblos", 'tab.bless-india-posters': "Pósteres «Bendice a la India»", 'tab.gospel-internet': "Evangelio × Internet", 'tab.country-posters': "Carteles por país", 'sub.country-posters': "un cartel para cada país", 'tab.poster-design': "Diseño de carteles", 'sub.poster-design': "todos los estilos y tamaños de cartel", 'tab.doxa-vision-card': "Tarjeta de visión Doxa",
  },
  fr: {
    backToTop: 'Retour en haut',
    'sec.dashboards': 'Tableaux de bord', 'sec.prayer': 'Mobilisation à la prière', 'sec.gospel': "Recherche sur l'Évangile", 'sec.experimental': 'Expérimental',
    'tab.dashboard-plus-grid': "Vue d'ensemble", 'sub.dashboard-plus-grid': 'tableau de bord + grille des peuples',
    'tab.research-map': 'Carte de recherche', 'sub.research-map': 'prière · engagement · régions',
    'tab.research-map-plus-grid': 'Recherche simple', 'sub.research-map-plus-grid': 'carte de recherche + grille des peuples',
    'tab.prayer-map': 'Progression de la prière', 'sub.prayer-map': 'carte mondiale de la prière',
    'tab.cities-internet': 'Villes avec Internet', 'sub.cities-internet': 'connectivité des villes clés',
    'tab.gospel-resources': "Ressources de l'Évangile", 'sub.gospel-resources': 'ressources par lieu',
    'tab.regions-dashboard': 'Régions', 'sub.regions-dashboard': 'régions et leurs pays',
    'tab.upg-100': "Affiches UPG100", 'sub.upg-100': 'ma liste des non atteints + affiches',
    navLabel: 'Cartes de recherche', meta: '{n} cartes', loading: 'Chargement de {label}…', loadFailed: 'Impossible de charger {label}.',
    manifestHint: "Cet onglet est composé à partir de manifest.json : construisez l'arborescence ou servez l'arborescence construite pour le charger.",
    close: 'Fermer', help: 'À propos de cette carte', desktopOnly: 'ordinateur uniquement', lab: 'bêta', experimentalSub: 'carte expérimentale',
    mobileNotBuilt: 'pas conçu pour mobile', dismiss: 'Fermer', desktopOnly: 'ordinateur uniquement', lab: 'bêta', experimentalSub: 'carte expérimentale',
    // The shared VerticalTabsLayout's own controls, VERBATIM from library/i18n/locales/fr/studio.json
    // (plugin studio's catalog) so both shells name the same buttons the same way.
    toggleList: "Afficher ou masquer la liste", openViews: "Ouvrir la liste des vues", expandList: "Déplier la liste", collapseList: "Replier la liste", collapse: "Replier", home: "Retour à l’accueil",
    // Experimental bundles known today (rail-length names; a bundle not listed keeps its manifest title).
    'tab.prayer-walk-planner': "Marches de prière", 'tab.upg-neighbor': "Voisin UPG", 'tab.key-cities': "Villes clés", 'tab.all-people-groups': "Tous les peuples", 'tab.pplr-data-maps': "Cartes de données PPLR", 'tab.wall-of-people-groups': "Mur des peuples", 'tab.bless-india-posters': "Affiches « Bénis l’Inde »", 'tab.gospel-internet': "Évangile × Internet", 'tab.country-posters': "Affiches par pays", 'sub.country-posters': "une affiche pour chaque pays", 'tab.poster-design': "Conception d’affiches", 'sub.poster-design': "tous les styles et formats d’affiche", 'tab.doxa-vision-card': "Carte de vision Doxa",
  },
  de: {
    backToTop: 'Nach oben',
    'sec.dashboards': 'Dashboards', 'sec.prayer': 'Gebetsmobilisierung', 'sec.gospel': 'Evangeliumsforschung', 'sec.experimental': 'Experimentell',
    'tab.dashboard-plus-grid': 'Gesamtbild', 'sub.dashboard-plus-grid': 'Dashboard + Raster der Volksgruppen',
    'tab.research-map': 'Forschungskarte', 'sub.research-map': 'Gebet · Engagement · Regionen',
    'tab.research-map-plus-grid': 'Einfache Recherche', 'sub.research-map-plus-grid': 'Forschungskarte + Raster der Volksgruppen',
    'tab.prayer-map': 'Gebetsfortschritt', 'sub.prayer-map': 'einfache Weltkarte des Gebets',
    'tab.cities-internet': 'Städte mit Internet', 'sub.cities-internet': 'Konnektivität wichtiger Städte',
    'tab.gospel-resources': 'Evangeliumsressourcen', 'sub.gospel-resources': 'Ressourcen nach Ort',
    'tab.regions-dashboard': 'Regionen', 'sub.regions-dashboard': 'Regionen und ihre Länder',
    'tab.upg-100': "UPG100-Poster", 'sub.upg-100': 'meine Liste der Unerreichten + Poster',
    navLabel: 'Forschungskarten', meta: '{n} Karten', loading: '{label} wird geladen…', loadFailed: '{label} konnte nicht geladen werden.',
    manifestHint: 'Dieser Tab wird aus manifest.json zusammengesetzt – bauen Sie den Baum oder stellen Sie den gebauten Baum bereit, um ihn zu laden.',
    close: 'Schließen', help: 'Über diese Karte', desktopOnly: 'nur Desktop', lab: 'Beta', experimentalSub: 'experimentelle Karte',
    mobileNotBuilt: 'nicht für Mobilgeräte', dismiss: 'Schließen', desktopOnly: 'nur Desktop', lab: 'Beta', experimentalSub: 'experimentelle Karte',
    // The shared VerticalTabsLayout's own controls, VERBATIM from library/i18n/locales/de/studio.json
    // (plugin studio's catalog) so both shells name the same buttons the same way.
    toggleList: "Liste ein-/ausblenden", openViews: "Ansichtsliste öffnen", expandList: "Liste ausklappen", collapseList: "Liste einklappen", collapse: "Einklappen", home: "Zurück zur Startseite",
    // Experimental bundles known today (rail-length names; a bundle not listed keeps its manifest title).
    'tab.prayer-walk-planner': "Gebetsspaziergänge", 'tab.upg-neighbor': "UPG-Nachbar", 'tab.key-cities': "Schlüsselstädte", 'tab.all-people-groups': "Alle Volksgruppen", 'tab.pplr-data-maps': "PPLR-Datenkarten", 'tab.wall-of-people-groups': "Wand der Volksgruppen", 'tab.bless-india-posters': "„Segne Indien“-Poster", 'tab.gospel-internet': "Evangelium × Internet", 'tab.country-posters': "Länderposter", 'sub.country-posters': "ein Poster für jedes Land", 'tab.poster-design': "Postergestaltung", 'sub.poster-design': "alle Posterstile und -größen", 'tab.doxa-vision-card': "Doxa-Visionskarte",
  },
  pt: {
    backToTop: 'Voltar ao topo',
    'sec.dashboards': 'Painéis', 'sec.prayer': 'Mobilização de oração', 'sec.gospel': 'Pesquisa do Evangelho', 'sec.experimental': 'Experimental',
    'tab.dashboard-plus-grid': 'Visão geral', 'sub.dashboard-plus-grid': 'painel + grade de povos',
    'tab.research-map': 'Mapa de pesquisa', 'sub.research-map': 'oração · engajamento · regiões',
    'tab.research-map-plus-grid': 'Pesquisa simples', 'sub.research-map-plus-grid': 'mapa de pesquisa + grade de povos',
    'tab.prayer-map': 'Progresso da oração', 'sub.prayer-map': 'mapa mundial de oração',
    'tab.cities-internet': 'Cidades com Internet', 'sub.cities-internet': 'conectividade das principais cidades',
    'tab.gospel-resources': 'Recursos do Evangelho', 'sub.gospel-resources': 'recursos por lugar',
    'tab.regions-dashboard': 'Regiões', 'sub.regions-dashboard': 'regiões e seus países',
    'tab.upg-100': "Cartazes UPG100", 'sub.upg-100': 'minha lista de não alcançados + cartazes',
    navLabel: 'Mapas de pesquisa', meta: '{n} mapas', loading: 'Carregando {label}…', loadFailed: 'Não foi possível carregar {label}.',
    manifestHint: 'Esta aba é composta a partir do manifest.json — compile a árvore ou sirva a árvore compilada para carregá-la.',
    close: 'Fechar', help: 'Sobre este mapa', desktopOnly: 'só no computador', lab: 'beta', experimentalSub: 'mapa experimental',
    mobileNotBuilt: 'não feito para celular', dismiss: 'Fechar', desktopOnly: 'só no computador', lab: 'beta', experimentalSub: 'mapa experimental',
    // The shared VerticalTabsLayout's own controls, VERBATIM from library/i18n/locales/pt/studio.json
    // (plugin studio's catalog) so both shells name the same buttons the same way.
    toggleList: "Mostrar ou ocultar a lista", openViews: "Abrir a lista de visualizações", expandList: "Expandir a lista", collapseList: "Recolher a lista", collapse: "Recolher", home: "Voltar à página inicial",
    // Experimental bundles known today (rail-length names; a bundle not listed keeps its manifest title).
    'tab.prayer-walk-planner': "Caminhadas de oração", 'tab.upg-neighbor': "Vizinho UPG", 'tab.key-cities': "Cidades-chave", 'tab.all-people-groups': "Todos os povos", 'tab.pplr-data-maps': "Mapas de dados PPLR", 'tab.wall-of-people-groups': "Mural dos povos", 'tab.bless-india-posters': "Pôsteres «Abençoe a Índia»", 'tab.gospel-internet': "Evangelho × Internet", 'tab.country-posters': "Cartazes por país", 'sub.country-posters': "um cartaz para cada país", 'tab.poster-design': "Design de cartazes", 'sub.poster-design': "todos os estilos e tamanhos de cartaz", 'tab.doxa-vision-card': "Cartão de visão Doxa",
  },
  it: {
    backToTop: 'Torna su',
    'sec.dashboards': 'Dashboard', 'sec.prayer': 'Mobilitazione alla preghiera', 'sec.gospel': 'Ricerca sul Vangelo', 'sec.experimental': 'Sperimentale',
    'tab.dashboard-plus-grid': "Quadro d'insieme", 'sub.dashboard-plus-grid': 'dashboard + griglia dei popoli',
    'tab.research-map': 'Mappa di ricerca', 'sub.research-map': 'preghiera · impegno · regioni',
    'tab.research-map-plus-grid': 'Ricerca semplice', 'sub.research-map-plus-grid': 'mappa di ricerca + griglia dei popoli',
    // Rail-length form. The library's legend title 'Avanzamento della preghiera' measured 191px in the
    // 176px rail label at both 1400px and 390px (2026-09-25 locale sweep) and was cut off.
    'tab.prayer-map': 'Avanzamento preghiera', 'sub.prayer-map': 'mappa mondiale della preghiera',
    'tab.cities-internet': 'Città con Internet', 'sub.cities-internet': 'connettività delle città chiave',
    'tab.gospel-resources': 'Risorse del Vangelo', 'sub.gospel-resources': 'risorse per luogo',
    'tab.regions-dashboard': 'Regioni', 'sub.regions-dashboard': 'regioni e i loro paesi',
    'tab.upg-100': "Poster UPG100", 'sub.upg-100': 'la mia lista dei non raggiunti + poster',
    navLabel: 'Mappe di ricerca', meta: '{n} mappe', loading: 'Caricamento di {label}…', loadFailed: 'Impossibile caricare {label}.',
    manifestHint: "Questa scheda è composta da manifest.json: compila l'albero o pubblica l'albero compilato per caricarla.",
    close: 'Chiudi', help: 'Informazioni su questa mappa', desktopOnly: 'solo desktop', lab: 'beta', experimentalSub: 'mappa sperimentale',
    mobileNotBuilt: 'non pensato per mobile', dismiss: 'Chiudi', desktopOnly: 'solo desktop', lab: 'beta', experimentalSub: 'mappa sperimentale',
    // The shared VerticalTabsLayout's own controls, VERBATIM from library/i18n/locales/it/studio.json
    // (plugin studio's catalog) so both shells name the same buttons the same way.
    toggleList: "Mostra o nascondi l’elenco", openViews: "Apri l’elenco delle viste", expandList: "Espandi l’elenco", collapseList: "Comprimi l’elenco", collapse: "Comprimi", home: "Torna alla home page",
    // Experimental bundles known today (rail-length names; a bundle not listed keeps its manifest title).
    'tab.prayer-walk-planner': "Passeggiate di preghiera", 'tab.upg-neighbor': "Vicino UPG", 'tab.key-cities': "Città chiave", 'tab.all-people-groups': "Tutti i popoli", 'tab.pplr-data-maps': "Mappe dati PPLR", 'tab.wall-of-people-groups': "Muro dei popoli", 'tab.bless-india-posters': "Poster «Benedici l’India»", 'tab.gospel-internet': "Vangelo × Internet", 'tab.country-posters': "Poster per paese", 'sub.country-posters': "un poster per ogni paese", 'tab.poster-design': "Design dei poster", 'sub.poster-design': "tutti gli stili e i formati dei poster", 'tab.doxa-vision-card': "Scheda visione Doxa",
  },
  ro: {
    backToTop: 'Sus',
    'sec.dashboards': 'Panouri', 'sec.prayer': 'Mobilizare la rugăciune', 'sec.gospel': 'Cercetarea Evangheliei', 'sec.experimental': 'Experimental',
    'tab.dashboard-plus-grid': 'Imaginea de ansamblu', 'sub.dashboard-plus-grid': 'panou + grila popoarelor',
    'tab.research-map': 'Hartă de cercetare', 'sub.research-map': 'rugăciune · implicare · regiuni',
    'tab.research-map-plus-grid': 'Cercetare simplă', 'sub.research-map-plus-grid': 'hartă de cercetare + grila popoarelor',
    'tab.prayer-map': 'Progresul rugăciunii', 'sub.prayer-map': 'hartă mondială a rugăciunii',
    'tab.cities-internet': 'Orașe cu internet', 'sub.cities-internet': 'conectivitatea orașelor-cheie',
    'tab.gospel-resources': 'Resurse ale Evangheliei', 'sub.gospel-resources': 'resurse după loc',
    'tab.regions-dashboard': 'Regiuni', 'sub.regions-dashboard': 'regiunile și țările lor',
    'tab.upg-100': "Afișe UPG100", 'sub.upg-100': 'lista mea de neatinși + afișe',
    navLabel: 'Hărți de cercetare', meta: '{n} hărți', loading: 'Se încarcă {label}…', loadFailed: '{label} nu a putut fi încărcat.',
    manifestHint: 'Această filă este compusă din manifest.json — construiți arborele sau serviți arborele construit pentru a o încărca.',
    close: 'Închide', help: 'Despre această hartă', desktopOnly: 'doar pe desktop', lab: 'beta', experimentalSub: 'hartă experimentală',
    mobileNotBuilt: 'nu e făcut pentru mobil', dismiss: 'Închide', desktopOnly: 'doar pe desktop', lab: 'beta', experimentalSub: 'hartă experimentală',
    // The shared VerticalTabsLayout's own controls, VERBATIM from library/i18n/locales/ro/studio.json
    // (plugin studio's catalog) so both shells name the same buttons the same way.
    toggleList: "Afișează sau ascunde lista", openViews: "Deschide lista de vizualizări", expandList: "Extinde lista", collapseList: "Restrânge lista", collapse: "Restrânge", home: "Înapoi la pagina principală",
    // Experimental bundles known today (rail-length names; a bundle not listed keeps its manifest title).
    'tab.prayer-walk-planner': "Plimbări de rugăciune", 'tab.upg-neighbor': "Vecin UPG", 'tab.key-cities': "Orașe-cheie", 'tab.all-people-groups': "Toate popoarele", 'tab.pplr-data-maps': "Hărți de date PPLR", 'tab.wall-of-people-groups': "Zidul popoarelor", 'tab.bless-india-posters': "Postere „Binecuvântează India”", 'tab.gospel-internet': "Evanghelie × internet", 'tab.country-posters': "Afișe pe țări", 'sub.country-posters': "un afiș pentru fiecare țară", 'tab.poster-design': "Design de afișe", 'sub.poster-design': "toate stilurile și dimensiunile de afiș", 'tab.doxa-vision-card': "Card de viziune Doxa",
  },
  ru: {
    backToTop: 'Наверх',
    'sec.dashboards': 'Панели', 'sec.prayer': 'Молитвенная мобилизация', 'sec.gospel': 'Исследование Евангелия', 'sec.experimental': 'Экспериментальное',
    'tab.dashboard-plus-grid': 'Общая картина', 'sub.dashboard-plus-grid': 'панель + таблица народов',
    'tab.research-map': 'Исследовательская карта', 'sub.research-map': 'молитва · вовлечённость · регионы',
    'tab.research-map-plus-grid': 'Простое исследование', 'sub.research-map-plus-grid': 'исследовательская карта + таблица народов',
    'tab.prayer-map': 'Прогресс молитвы', 'sub.prayer-map': 'простая карта молитвы мира',
    'tab.cities-internet': 'Города с интернетом', 'sub.cities-internet': 'подключённость ключевых городов',
    'tab.gospel-resources': 'Евангельские ресурсы', 'sub.gospel-resources': 'ресурсы по местам',
    'tab.regions-dashboard': 'Регионы', 'sub.regions-dashboard': 'регионы и их страны',
    'tab.upg-100': "Плакаты UPG100", 'sub.upg-100': 'мой список недостигнутых + плакаты',
    navLabel: 'Исследовательские карты', meta: 'Карт: {n}', loading: 'Загрузка: {label}…', loadFailed: 'Не удалось загрузить: {label}.',
    manifestHint: 'Эта вкладка собирается из manifest.json — соберите дерево или разместите собранное дерево, чтобы загрузить её.',
    close: 'Закрыть', help: 'Об этой карте', desktopOnly: 'только на компьютере', lab: 'бета', experimentalSub: 'экспериментальная карта',
    mobileNotBuilt: 'не для телефона', dismiss: 'Закрыть', desktopOnly: 'только на компьютере', lab: 'бета', experimentalSub: 'экспериментальная карта',
    // The shared VerticalTabsLayout's own controls, VERBATIM from library/i18n/locales/ru/studio.json
    // (plugin studio's catalog) so both shells name the same buttons the same way.
    toggleList: "Показать или скрыть список", openViews: "Открыть список представлений", expandList: "Развернуть список", collapseList: "Свернуть список", collapse: "Свернуть", home: "На главную страницу",
    // Experimental bundles known today (rail-length names; a bundle not listed keeps its manifest title).
    'tab.prayer-walk-planner': "Молитвенные прогулки", 'tab.upg-neighbor': "Сосед UPG", 'tab.key-cities': "Ключевые города", 'tab.all-people-groups': "Все народы", 'tab.pplr-data-maps': "Карты данных PPLR", 'tab.wall-of-people-groups': "Стена народов", 'tab.bless-india-posters': "Плакаты «Благослови Индию»", 'tab.gospel-internet': "Евангелие × интернет", 'tab.country-posters': "Плакаты по странам", 'sub.country-posters': "плакат для каждой страны", 'tab.poster-design': "Дизайн плакатов", 'sub.poster-design': "все стили и размеры плакатов", 'tab.doxa-vision-card': "Карточка видения Doxa",
  },
  ar: {
    backToTop: 'إلى الأعلى',
    'sec.dashboards': 'لوحات المعلومات', 'sec.prayer': 'التعبئة للصلاة', 'sec.gospel': 'أبحاث الإنجيل', 'sec.experimental': 'تجريبي',
    'tab.dashboard-plus-grid': 'الصورة الكاملة', 'sub.dashboard-plus-grid': 'لوحة معلومات + شبكة الشعوب',
    'tab.research-map': 'خريطة البحث', 'sub.research-map': 'الصلاة · الانخراط · المناطق',
    'tab.research-map-plus-grid': 'بحث مبسّط', 'sub.research-map-plus-grid': 'خريطة البحث + شبكة الشعوب',
    'tab.prayer-map': 'تقدم الصلاة', 'sub.prayer-map': 'خريطة عالمية مبسّطة للصلاة',
    'tab.cities-internet': 'مدن متصلة بالإنترنت', 'sub.cities-internet': 'اتصال المدن الرئيسية',
    'tab.gospel-resources': 'موارد الإنجيل', 'sub.gospel-resources': 'الموارد حسب المكان',
    'tab.regions-dashboard': 'المناطق', 'sub.regions-dashboard': 'المناطق ودولها',
    'tab.upg-100': "ملصقات UPG100", 'sub.upg-100': 'قائمتي لغير المُبشَّرين + ملصقات',
    navLabel: 'خرائط البحث', meta: 'عدد الخرائط: {n}', loading: 'جارٍ تحميل {label}…', loadFailed: 'تعذّر تحميل {label}.',
    manifestHint: 'تُبنى علامة التبويب هذه من manifest.json — ابنِ الشجرة أو قدّم الشجرة المبنية لتحميلها.',
    close: 'إغلاق', help: 'عن هذه الخريطة', desktopOnly: 'على الحاسوب فقط', lab: 'تجريبي', experimentalSub: 'خريطة تجريبية',
    mobileNotBuilt: 'غير مُعدّ للهاتف', dismiss: 'إغلاق', desktopOnly: 'على الحاسوب فقط', lab: 'تجريبي', experimentalSub: 'خريطة تجريبية',
    // The shared VerticalTabsLayout's own controls, VERBATIM from library/i18n/locales/ar/studio.json
    // (plugin studio's catalog) so both shells name the same buttons the same way.
    toggleList: "إظهار القائمة أو إخفاؤها", openViews: "فتح قائمة العروض", expandList: "توسيع القائمة", collapseList: "طي القائمة", collapse: "طي", home: "العودة إلى الصفحة الرئيسية",
    // Experimental bundles known today (rail-length names; a bundle not listed keeps its manifest title).
    'tab.prayer-walk-planner': "جولات الصلاة", 'tab.upg-neighbor': "جار UPG", 'tab.key-cities': "المدن الرئيسية", 'tab.all-people-groups': "جميع الشعوب", 'tab.pplr-data-maps': "خرائط بيانات PPLR", 'tab.wall-of-people-groups': "جدار الشعوب", 'tab.bless-india-posters': "ملصقات باركوا الهند", 'tab.gospel-internet': "الإنجيل × الإنترنت", 'tab.country-posters': "ملصقات الدول", 'sub.country-posters': "ملصق لكل دولة", 'tab.poster-design': "تصميم الملصقات", 'sub.poster-design': "كل أنماط الملصقات وأحجامها", 'tab.doxa-vision-card': "بطاقة رؤية Doxa",
  },
  hi: {
    backToTop: 'ऊपर जाएँ',
    'sec.dashboards': 'डैशबोर्ड', 'sec.prayer': 'प्रार्थना संचालन', 'sec.gospel': 'सुसमाचार शोध', 'sec.experimental': 'प्रायोगिक',
    'tab.dashboard-plus-grid': 'संपूर्ण चित्र', 'sub.dashboard-plus-grid': 'डैशबोर्ड + जनसमूहों की ग्रिड',
    'tab.research-map': 'शोध मानचित्र', 'sub.research-map': 'प्रार्थना · सहभागिता · क्षेत्र',
    'tab.research-map-plus-grid': 'सरल शोध', 'sub.research-map-plus-grid': 'शोध मानचित्र + जनसमूहों की ग्रिड',
    'tab.prayer-map': 'प्रार्थना प्रगति', 'sub.prayer-map': 'सरल विश्व प्रार्थना मानचित्र',
    'tab.cities-internet': 'इंटरनेट वाले शहर', 'sub.cities-internet': 'प्रमुख शहरों की कनेक्टिविटी',
    'tab.gospel-resources': 'सुसमाचार संसाधन', 'sub.gospel-resources': 'स्थान के अनुसार संसाधन',
    'tab.regions-dashboard': 'क्षेत्र', 'sub.regions-dashboard': 'क्षेत्र और उनके देश',
    'tab.upg-100': "UPG100 पोस्टर", 'sub.upg-100': 'मेरी अप्राप्त सूची + पोस्टर',
    navLabel: 'शोध मानचित्र', meta: '{n} मानचित्र', loading: '{label} लोड हो रहा है…', loadFailed: '{label} लोड नहीं हो सका।',
    manifestHint: 'यह टैब manifest.json से बनता है — इसे लोड करने के लिए ट्री बनाएँ या बना हुआ ट्री सर्व करें।',
    close: 'बंद करें', help: 'इस नक्शे के बारे में', desktopOnly: 'केवल डेस्कटॉप', lab: 'बीटा', experimentalSub: 'प्रायोगिक मानचित्र',
    mobileNotBuilt: 'मोबाइल के लिए नहीं बना', dismiss: 'बंद करें', desktopOnly: 'केवल डेस्कटॉप', lab: 'बीटा', experimentalSub: 'प्रायोगिक मानचित्र',
    // The shared VerticalTabsLayout's own controls, VERBATIM from library/i18n/locales/hi/studio.json
    // (plugin studio's catalog) so both shells name the same buttons the same way.
    toggleList: "सूची दिखाएँ या छिपाएँ", openViews: "दृश्यों की सूची खोलें", expandList: "सूची फैलाएँ", collapseList: "सूची संक्षिप्त करें", collapse: "संक्षिप्त करें", home: "होमपेज पर वापस जाएँ",
    // Experimental bundles known today (rail-length names; a bundle not listed keeps its manifest title).
    'tab.prayer-walk-planner': "प्रार्थना पदयात्रा", 'tab.upg-neighbor': "UPG पड़ोसी", 'tab.key-cities': "प्रमुख शहर", 'tab.all-people-groups': "सभी जनसमूह", 'tab.pplr-data-maps': "PPLR डेटा मानचित्र", 'tab.wall-of-people-groups': "जनसमूहों की दीवार", 'tab.bless-india-posters': "भारत को आशीष दें — पोस्टर", 'tab.gospel-internet': "सुसमाचार × इंटरनेट", 'tab.country-posters': "देश पोस्टर", 'sub.country-posters': "हर देश के लिए एक पोस्टर", 'tab.poster-design': "पोस्टर डिज़ाइन", 'sub.poster-design': "हर पोस्टर शैली और आकार", 'tab.doxa-vision-card': "Doxa दर्शन कार्ड",
  },
  zh: {
    backToTop: '回到顶部',
    'sec.dashboards': '仪表板', 'sec.prayer': '祷告动员', 'sec.gospel': '福音研究', 'sec.experimental': '实验性',
    'tab.dashboard-plus-grid': '全景', 'sub.dashboard-plus-grid': '仪表板 + 民族网格',
    'tab.research-map': '研究地图', 'sub.research-map': '祷告 · 参与 · 区域',
    'tab.research-map-plus-grid': '简易研究', 'sub.research-map-plus-grid': '研究地图 + 民族网格',
    'tab.prayer-map': '祷告进度', 'sub.prayer-map': '简易世界祷告地图',
    'tab.cities-internet': '有互联网的城市', 'sub.cities-internet': '主要城市的网络连接',
    'tab.gospel-resources': '福音资源', 'sub.gospel-resources': '按地点划分的资源',
    'tab.regions-dashboard': '区域', 'sub.regions-dashboard': '区域及其国家',
    'tab.upg-100': "UPG100 海报", 'sub.upg-100': '我的未得之民名单 + 海报',
    navLabel: '研究地图', meta: '{n} 张地图', loading: '正在加载{label}…', loadFailed: '无法加载{label}。',
    manifestHint: '此标签页由 manifest.json 组成——请构建目录树或提供已构建的目录树以加载它。',
    close: '关闭', help: '关于此地图', desktopOnly: '仅限桌面', lab: '测试版', experimentalSub: '实验性地图',
    mobileNotBuilt: '未针对手机设计', dismiss: '关闭', desktopOnly: '仅限桌面', lab: '测试版', experimentalSub: '实验性地图',
    // The shared VerticalTabsLayout's own controls, VERBATIM from library/i18n/locales/zh/studio.json
    // (plugin studio's catalog) so both shells name the same buttons the same way.
    toggleList: "显示或隐藏列表", openViews: "打开视图列表", expandList: "展开列表", collapseList: "折叠列表", collapse: "折叠", home: "返回首页",
    // Experimental bundles known today (rail-length names; a bundle not listed keeps its manifest title).
    'tab.prayer-walk-planner': "祷告行走", 'tab.upg-neighbor': "UPG 邻居", 'tab.key-cities': "重点城市", 'tab.all-people-groups': "所有民族", 'tab.pplr-data-maps': "PPLR 数据地图", 'tab.wall-of-people-groups': "民族之墙", 'tab.bless-india-posters': "祝福印度海报", 'tab.gospel-internet': "福音 × 互联网", 'tab.country-posters': "国家海报", 'sub.country-posters': "每个国家一张海报", 'tab.poster-design': "海报设计", 'sub.poster-design': "所有海报样式与尺寸", 'tab.doxa-vision-card': "Doxa 异象卡",
  }
}

export const LOCALES = Object.keys(STRINGS)

/** True when the string table defines `key` (English is the source, so it has every key). */
export function hasKey(key) { return Object.prototype.hasOwnProperty.call(STRINGS.en, key) }

/** Translate `key` into `locale`, falling back to English, then to the key itself. */
export function translate(locale, key, params) {
  const table = STRINGS[locale] || STRINGS.en
  let s = table[key] ?? STRINGS.en[key] ?? key
  if (params) for (const k in params) s = s.split('{' + k + '}').join(String(params[k]))
  return s
}
