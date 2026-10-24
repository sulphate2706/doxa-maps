/**
 * experimentalHelp.js — the "?" text for each map on the Experimental shelf, bottom line up front:
 * `what` = what the map is for, `how` = how to use it. One pair per bundle id, in every locale the
 * shell speaks (src/strings.js). A bundle with no entry simply shows no "?" rather than a guess.
 *
 * helpFor(bundleId, locale) → { what, how } | null, falling back to English per bundle.
 *
 * ONE SOURCE OF TRUTH PER MAP: UPG Neighbor has no entry here on purpose. It carries no hosted "?", and its
 * own "How it works" (neighbor.about.*) is its explainer; a second text here could only drift from it.
 */

export const EXPERIMENTAL_HELP = {
  en: {
    'prayer-walk-planner': { what: 'Plan a prayer walk: draw the areas your teams will cover and print each one as a one-page map.', how: 'Draw a zone, name it, select the zones you need and press Print. Each zone prints on its own page with coordinates, one map per team.' },
    'gospel-internet': { what: 'See which of the ~2,000 people groups already have gospel resources in their language, and where the internet can carry those resources to them.', how: 'Explore the language tree, the bounded and centered sets and the map. Pick a list on the side to narrow every view.' },
    'country-posters': { what: 'Printable prayer posters, one per country, showing its people groups.', how: 'Pick a country from the poster list or on the map, then print it straight from your browser.' },
    'all-people-groups': { what: 'Every people group on earth on one map, colored by how reached it is, with the DOXA prayer set highlighted.', how: 'Click a category in the legend to show only those groups. Click a dot for its details and prayer link.' },
    'doxa-vision-card': { what: 'The remaining task in one card: all people groups, then the unreached, then the frontier, then the DOXA prayer set.', how: 'Read it from top to bottom. Every number is computed from the people-group data, not typed in.' },
    'pplr-data-maps': { what: 'People-group research data on maps: language families, people clusters, religions and data-source coverage.', how: 'Choose a view from the tabs, then use the legend to highlight a family, cluster or religion on the map.' },
    'wall-of-people-groups': { what: 'Every DOXA people group on one wall, to bless them. In Bless mode the wall is the printable poster (5 × 8 ft by default), each group with a blessing verse; in Social mode it is a shared prayer wall.', how: 'Bless: look around the poster exactly as it will print, pick a size and press Print HD poster. Social: pray for a group, read or leave comments, and share its prayer page.' },
  },
  es: {
    'prayer-walk-planner': { what: 'Planifique una caminata de oración: dibuje las zonas que recorrerán sus equipos e imprima cada una como un mapa de una página.', how: 'Dibuje una zona, póngale nombre, seleccione las zonas que necesita y pulse Imprimir. Cada zona se imprime en su propia página con coordenadas: un mapa por equipo.' },
    'gospel-internet': { what: 'Vea cuáles de los ~2000 grupos de pueblos ya tienen recursos del evangelio en su idioma, y dónde internet puede llevárselos.', how: 'Explore el árbol de idiomas, los conjuntos delimitado y centrado y el mapa. Elija una lista al lado para acotar cada vista.' },
    'country-posters': { what: 'Carteles de oración para imprimir, uno por país, con sus grupos de pueblos.', how: 'Elija un país en la lista de carteles o en el mapa, e imprímalo directamente desde el navegador.' },
    'all-people-groups': { what: 'Todos los grupos de pueblos del mundo en un mapa, coloreados según lo alcanzados que están, con el conjunto de oración de DOXA resaltado.', how: 'Haga clic en una categoría de la leyenda para ver solo esos grupos. Haga clic en un punto para ver sus datos y el enlace de oración.' },
    'doxa-vision-card': { what: 'La tarea pendiente en una tarjeta: todos los grupos de pueblos, luego los no alcanzados, luego la frontera y luego el conjunto de oración de DOXA.', how: 'Léala de arriba abajo. Cada cifra se calcula a partir de los datos, no se escribe a mano.' },
    'pplr-data-maps': { what: 'Datos de investigación sobre grupos de pueblos en mapas: familias lingüísticas, agrupaciones de pueblos, religiones y cobertura de fuentes.', how: 'Elija una vista en las pestañas y use la leyenda para resaltar una familia, agrupación o religión en el mapa.' },
    'wall-of-people-groups': { what: 'Todos los grupos de pueblos de DOXA en un muro, para bendecirlos. En el modo Bendecir el muro es el póster para imprimir (5 × 8 pies por defecto), cada grupo con un versículo de bendición; en el modo Social es un muro de oración compartido.', how: 'Bendecir: recorra el póster tal como se imprimirá, elija un tamaño y pulse Imprimir póster HD. Social: ore por un grupo, lea o deje comentarios y comparta su página de oración.' },
  },
  fr: {
    'prayer-walk-planner': { what: 'Préparez une marche de prière : dessinez les zones que vos équipes parcourront et imprimez chacune sur une carte d’une page.', how: 'Dessinez une zone, nommez-la, sélectionnez les zones voulues et cliquez sur Imprimer. Chaque zone s’imprime sur sa propre page avec ses coordonnées : une carte par équipe.' },
    'gospel-internet': { what: 'Voyez lesquels des ~2 000 groupes de peuples ont déjà des ressources de l’Évangile dans leur langue, et où internet peut les leur apporter.', how: 'Explorez l’arbre des langues, les ensembles délimité et centré et la carte. Choisissez une liste sur le côté pour affiner chaque vue.' },
    'country-posters': { what: 'Des affiches de prière à imprimer, une par pays, avec ses groupes de peuples.', how: 'Choisissez un pays dans la liste des affiches ou sur la carte, puis imprimez-le directement depuis le navigateur.' },
    'all-people-groups': { what: 'Tous les groupes de peuples du monde sur une carte, colorés selon leur degré d’atteinte, avec l’ensemble de prière DOXA mis en valeur.', how: 'Cliquez sur une catégorie de la légende pour n’afficher que ces groupes. Cliquez sur un point pour ses détails et son lien de prière.' },
    'doxa-vision-card': { what: 'La tâche restante en une carte : tous les groupes de peuples, puis les non atteints, puis la frontière, puis l’ensemble de prière DOXA.', how: 'Lisez-la de haut en bas. Chaque chiffre est calculé à partir des données, pas saisi à la main.' },
    'pplr-data-maps': { what: 'Des données de recherche sur les groupes de peuples, en cartes : familles de langues, grappes de peuples, religions et couverture des sources.', how: 'Choisissez une vue dans les onglets, puis utilisez la légende pour mettre en valeur une famille, une grappe ou une religion.' },
    'wall-of-people-groups': { what: 'Tous les groupes de peuples DOXA sur un seul mur, pour les bénir. En mode Bénir, le mur est l’affiche à imprimer (5 × 8 pieds par défaut), chaque groupe avec un verset de bénédiction ; en mode Social, c’est un mur de prière partagé.', how: 'Bénir : parcourez l’affiche telle qu’elle s’imprimera, choisissez une taille et appuyez sur Imprimer l’affiche HD. Social : priez pour un groupe, lisez ou laissez des commentaires et partagez sa page de prière.' },
  },
  de: {
    'prayer-walk-planner': { what: 'Einen Gebetsspaziergang planen: die Gebiete Ihrer Teams zeichnen und jedes als einseitige Karte drucken.', how: 'Zeichnen Sie ein Gebiet, benennen Sie es, wählen Sie die nötigen Gebiete und drücken Sie auf Drucken. Jedes Gebiet wird mit Koordinaten auf einer eigenen Seite gedruckt: eine Karte pro Team.' },
    'gospel-internet': { what: 'Sehen, welche der ~2.000 Volksgruppen schon Evangeliumsressourcen in ihrer Sprache haben und wo das Internet sie zu ihnen bringen kann.', how: 'Erkunden Sie den Sprachbaum, die begrenzte und die zentrierte Menge und die Karte. Wählen Sie seitlich eine Liste, um jede Ansicht einzugrenzen.' },
    'country-posters': { what: 'Druckbare Gebetsplakate, eines pro Land, mit seinen Volksgruppen.', how: 'Wählen Sie ein Land in der Plakatliste oder auf der Karte und drucken Sie es direkt aus dem Browser.' },
    'all-people-groups': { what: 'Alle Volksgruppen der Welt auf einer Karte, nach Erreichtheit eingefärbt, mit dem DOXA-Gebetsset hervorgehoben.', how: 'Klicken Sie auf eine Kategorie der Legende, um nur diese Gruppen zu zeigen. Klicken Sie auf einen Punkt für Details und den Gebetslink.' },
    'doxa-vision-card': { what: 'Die verbleibende Aufgabe auf einer Karte: alle Volksgruppen, dann die unerreichten, dann die Frontier-Gruppen, dann das DOXA-Gebetsset.', how: 'Lesen Sie sie von oben nach unten. Jede Zahl wird aus den Daten berechnet, nicht eingetippt.' },
    'pplr-data-maps': { what: 'Forschungsdaten zu Volksgruppen auf Karten: Sprachfamilien, Volkscluster, Religionen und Quellenabdeckung.', how: 'Wählen Sie oben eine Ansicht und heben Sie mit der Legende eine Familie, einen Cluster oder eine Religion hervor.' },
    'wall-of-people-groups': { what: 'Jede DOXA-Volksgruppe auf einer Wand, um sie zu segnen. Im Modus Segnen ist die Wand das druckbare Poster (standardmäßig 5 × 8 Fuß), jede Gruppe mit einem Segensvers; im Modus Sozial ist sie eine gemeinsame Gebetswand.', how: 'Segnen: Sehen Sie sich das Poster genau so an, wie es gedruckt wird, wählen Sie eine Größe und drücken Sie HD-Poster drucken. Sozial: Beten Sie für eine Gruppe, lesen oder schreiben Sie Kommentare und teilen Sie ihre Gebetsseite.' },
  },
  pt: {
    'prayer-walk-planner': { what: 'Planeje uma caminhada de oração: desenhe as áreas que suas equipes vão cobrir e imprima cada uma como um mapa de uma página.', how: 'Desenhe uma zona, dê um nome, selecione as zonas necessárias e clique em Imprimir. Cada zona sai em sua própria página com coordenadas: um mapa por equipe.' },
    'gospel-internet': { what: 'Veja quais dos ~2.000 grupos de povos já têm recursos do evangelho no seu idioma, e onde a internet pode levá-los até eles.', how: 'Explore a árvore de idiomas, os conjuntos delimitado e centrado e o mapa. Escolha uma lista ao lado para filtrar cada vista.' },
    'country-posters': { what: 'Cartazes de oração para imprimir, um por país, com seus grupos de povos.', how: 'Escolha um país na lista de cartazes ou no mapa e imprima direto do navegador.' },
    'all-people-groups': { what: 'Todos os grupos de povos do mundo num mapa, coloridos pelo grau de alcance, com o conjunto de oração da DOXA em destaque.', how: 'Clique numa categoria da legenda para ver só esses grupos. Clique num ponto para ver detalhes e o link de oração.' },
    'doxa-vision-card': { what: 'A tarefa restante num cartão: todos os grupos de povos, depois os não alcançados, depois a fronteira, depois o conjunto de oração da DOXA.', how: 'Leia de cima para baixo. Cada número é calculado a partir dos dados, não digitado.' },
    'pplr-data-maps': { what: 'Dados de pesquisa sobre grupos de povos em mapas: famílias linguísticas, agrupamentos de povos, religiões e cobertura das fontes.', how: 'Escolha uma vista nas abas e use a legenda para destacar uma família, agrupamento ou religião no mapa.' },
    'wall-of-people-groups': { what: 'Todos os grupos de povos da DOXA num só mural, para abençoá-los. No modo Abençoar, o mural é o cartaz para imprimir (5 × 8 pés por padrão), cada grupo com um versículo de bênção; no modo Social, é um mural de oração partilhado.', how: 'Abençoar: percorra o cartaz tal como será impresso, escolha um tamanho e prima Imprimir cartaz HD. Social: ore por um grupo, leia ou deixe comentários e partilhe a sua página de oração.' },
  },
  it: {
    'prayer-walk-planner': { what: 'Pianifica una camminata di preghiera: disegna le zone che le tue squadre percorreranno e stampa ognuna come mappa di una pagina.', how: 'Disegna una zona, dalle un nome, seleziona le zone che servono e premi Stampa. Ogni zona si stampa su una pagina con le coordinate: una mappa per squadra.' },
    'gospel-internet': { what: 'Scopri quali dei ~2.000 gruppi etnici hanno già risorse del vangelo nella loro lingua, e dove internet può portargliele.', how: 'Esplora l’albero delle lingue, gli insiemi delimitato e centrato e la mappa. Scegli un elenco a lato per restringere ogni vista.' },
    'country-posters': { what: 'Poster di preghiera da stampare, uno per paese, con i suoi gruppi etnici.', how: 'Scegli un paese dall’elenco dei poster o sulla mappa e stampalo direttamente dal browser.' },
    'all-people-groups': { what: 'Tutti i gruppi etnici del mondo su una mappa, colorati secondo quanto sono raggiunti, con l’insieme di preghiera DOXA evidenziato.', how: 'Clicca una categoria della legenda per mostrare solo quei gruppi. Clicca un punto per dettagli e link di preghiera.' },
    'doxa-vision-card': { what: 'Il compito rimanente in una scheda: tutti i gruppi etnici, poi i non raggiunti, poi la frontiera, poi l’insieme di preghiera DOXA.', how: 'Leggila dall’alto in basso. Ogni numero è calcolato dai dati, non digitato.' },
    'pplr-data-maps': { what: 'Dati di ricerca sui gruppi etnici su mappa: famiglie linguistiche, cluster di popoli, religioni e copertura delle fonti.', how: 'Scegli una vista dalle schede, poi usa la legenda per evidenziare una famiglia, un cluster o una religione.' },
    'wall-of-people-groups': { what: 'Tutti i gruppi etnici DOXA su un solo muro, per benedirli. In modalità Benedire il muro è il poster da stampare (5 × 8 piedi di default), ogni gruppo con un versetto di benedizione; in modalità Social è un muro di preghiera condiviso.', how: 'Benedire: esplora il poster esattamente come verrà stampato, scegli una dimensione e premi Stampa poster HD. Social: prega per un gruppo, leggi o lascia commenti e condividi la sua pagina di preghiera.' },
  },
  ro: {
    'prayer-walk-planner': { what: 'Planificați o plimbare de rugăciune: desenați zonele pe care le vor parcurge echipele și tipăriți fiecare ca hartă de o pagină.', how: 'Desenați o zonă, dați-i un nume, selectați zonele necesare și apăsați Tipărire. Fiecare zonă se tipărește pe o pagină, cu coordonate: câte o hartă pentru fiecare echipă.' },
    'gospel-internet': { what: 'Vedeți care dintre cele ~2.000 de grupuri de popoare au deja resurse ale Evangheliei în limba lor și unde le poate duce internetul.', how: 'Explorați arborele limbilor, mulțimile delimitată și centrată și harta. Alegeți o listă din lateral pentru a restrânge fiecare vedere.' },
    'country-posters': { what: 'Afișe de rugăciune de tipărit, câte unul pentru fiecare țară, cu grupurile ei de popoare.', how: 'Alegeți o țară din lista de afișe sau de pe hartă și tipăriți-o direct din browser.' },
    'all-people-groups': { what: 'Toate grupurile de popoare ale lumii pe o hartă, colorate după cât sunt de atinse, cu setul de rugăciune DOXA evidențiat.', how: 'Faceți clic pe o categorie din legendă pentru a afișa doar acele grupuri. Faceți clic pe un punct pentru detalii și linkul de rugăciune.' },
    'doxa-vision-card': { what: 'Sarcina rămasă într-un card: toate grupurile de popoare, apoi cele neatinse, apoi cele de frontieră, apoi setul de rugăciune DOXA.', how: 'Citiți-l de sus în jos. Fiecare număr este calculat din date, nu tastat.' },
    'pplr-data-maps': { what: 'Date de cercetare despre grupurile de popoare pe hărți: familii de limbi, grupuri de popoare, religii și acoperirea surselor.', how: 'Alegeți o vedere din file, apoi folosiți legenda pentru a evidenția o familie, un grup sau o religie.' },
    'wall-of-people-groups': { what: 'Toate grupurile de popoare DOXA pe un singur perete, ca să le binecuvântăm. În modul Binecuvântare, peretele este afișul de tipărit (5 × 8 picioare implicit), fiecare grup cu un verset de binecuvântare; în modul Social este un perete de rugăciune comun.', how: 'Binecuvântare: explorați afișul exact cum se va tipări, alegeți o dimensiune și apăsați Tipărește afișul HD. Social: rugați-vă pentru un grup, citiți sau lăsați comentarii și distribuiți pagina lui de rugăciune.' },
  },
  ru: {
    'prayer-walk-planner': { what: 'Спланируйте молитвенную прогулку: нарисуйте районы для ваших команд и распечатайте каждый как карту на одну страницу.', how: 'Нарисуйте зону, назовите её, выберите нужные зоны и нажмите «Печать». Каждая зона печатается на отдельной странице с координатами — по карте на команду.' },
    'gospel-internet': { what: 'Узнайте, у каких из ~2000 народов уже есть евангельские материалы на их языке и где интернет может донести их до них.', how: 'Исследуйте языковое дерево, ограниченное и центрированное множества и карту. Выберите список сбоку, чтобы сузить любой вид.' },
    'country-posters': { what: 'Молитвенные плакаты для печати, по одному на страну, с её народами.', how: 'Выберите страну в списке плакатов или на карте и распечатайте прямо из браузера.' },
    'all-people-groups': { what: 'Все народы мира на одной карте, окрашенные по степени достигнутости, с выделенным молитвенным набором DOXA.', how: 'Нажмите категорию в легенде, чтобы показать только эти группы. Нажмите точку, чтобы увидеть сведения и ссылку для молитвы.' },
    'doxa-vision-card': { what: 'Оставшаяся задача на одной карточке: все народы, затем недостигнутые, затем пограничные, затем молитвенный набор DOXA.', how: 'Читайте сверху вниз. Каждое число вычислено из данных, а не введено вручную.' },
    'pplr-data-maps': { what: 'Исследовательские данные о народах на картах: языковые семьи, кластеры народов, религии и охват источников.', how: 'Выберите вид во вкладках, затем выделите семью, кластер или религию с помощью легенды.' },
    'wall-of-people-groups': { what: 'Все народы DOXA на одной стене, чтобы благословлять их. В режиме «Благословение» стена — это плакат для печати (по умолчанию 5 × 8 футов), у каждого народа — стих благословения; в режиме «Соцсеть» это общая молитвенная стена.', how: '«Благословение»: просмотрите плакат точно таким, каким он будет напечатан, выберите размер и нажмите «Печать плаката HD». «Соцсеть»: молитесь о народе, читайте и оставляйте комментарии, делитесь его молитвенной страницей.' },
  },
  ar: {
    'prayer-walk-planner': { what: 'خطِّط لجولة صلاة: ارسم المناطق التي ستغطيها فرقك واطبع كل منطقة خريطةً من صفحة واحدة.', how: 'ارسم منطقة وسمِّها، واختر المناطق التي تحتاجها ثم اضغط «طباعة». تُطبع كل منطقة في صفحة مستقلة مع إحداثياتها: خريطة لكل فريق.' },
    'gospel-internet': { what: 'اعرف أيَّ الشعوب الألفين تقريبًا لديها بالفعل موارد للإنجيل بلغتها، وأين يمكن للإنترنت أن يوصلها إليها.', how: 'استكشف شجرة اللغات والمجموعتين المحدودة والمتمركزة والخريطة. اختر قائمة من الجانب لتضييق كل عرض.' },
    'country-posters': { what: 'ملصقات صلاة للطباعة، ملصق لكل بلد، تُظهر شعوبه.', how: 'اختر بلدًا من قائمة الملصقات أو على الخريطة، ثم اطبعه مباشرة من المتصفح.' },
    'all-people-groups': { what: 'كل شعوب العالم على خريطة واحدة، ملوَّنة بحسب درجة وصول الإنجيل إليها، مع إبراز مجموعة صلاة DOXA.', how: 'انقر فئة في مفتاح الخريطة لعرض تلك الشعوب فقط. انقر نقطة لترى تفاصيلها ورابط الصلاة.' },
    'doxa-vision-card': { what: 'المهمة المتبقية في بطاقة واحدة: كل الشعوب، ثم غير المُبشَّرة، ثم الحدودية، ثم مجموعة صلاة DOXA.', how: 'اقرأها من الأعلى إلى الأسفل. كل رقم محسوب من البيانات، وليس مكتوبًا يدويًا.' },
    'pplr-data-maps': { what: 'بيانات بحثية عن الشعوب على خرائط: العائلات اللغوية والعناقيد الشعبية والأديان وتغطية المصادر.', how: 'اختر عرضًا من التبويبات، ثم استخدم مفتاح الخريطة لإبراز عائلة أو عنقود أو دين.' },
    'wall-of-people-groups': { what: 'كل شعوب DOXA على جدار واحد لنباركها. في وضع «بركة» يكون الجدار هو الملصق الجاهز للطباعة (5 × 8 أقدام افتراضيًا)، ولكل شعب آية بركة؛ وفي وضع «تفاعلي» يكون جدار صلاة مشتركًا.', how: '«بركة»: تجوّل في الملصق كما سيُطبع تمامًا، واختر المقاس ثم اضغط «طباعة ملصق عالي الدقة». «تفاعلي»: صلِّ لأجل شعب، واقرأ التعليقات أو اكتب تعليقًا، وشارك صفحة الصلاة الخاصة به.' },
  },
  hi: {
    'prayer-walk-planner': { what: 'प्रार्थना-यात्रा की योजना बनाएँ: अपनी टीमों के क्षेत्र बनाएँ और हर क्षेत्र को एक पन्ने के नक्शे के रूप में छापें।', how: 'एक क्षेत्र बनाएँ, उसे नाम दें, ज़रूरी क्षेत्र चुनें और प्रिंट दबाएँ। हर क्षेत्र निर्देशांकों के साथ अपने पन्ने पर छपता है: हर टीम के लिए एक नक्शा।' },
    'gospel-internet': { what: 'देखें कि लगभग 2,000 जन-समूहों में से किनके पास उनकी भाषा में सुसमाचार के संसाधन पहले से हैं, और इंटरनेट उन्हें कहाँ तक पहुँचा सकता है।', how: 'भाषा-वृक्ष, सीमित और केंद्रित समुच्चय और नक्शा देखें। हर दृश्य को सीमित करने के लिए बगल में एक सूची चुनें।' },
    'country-posters': { what: 'छापने योग्य प्रार्थना-पोस्टर, हर देश के लिए एक, उसके जन-समूहों के साथ।', how: 'पोस्टर सूची में या नक्शे पर कोई देश चुनें, फिर सीधे ब्राउज़र से छापें।' },
    'all-people-groups': { what: 'दुनिया के सभी जन-समूह एक नक्शे पर, इस आधार पर रंगे हुए कि वे कितने पहुँचे हुए हैं, DOXA प्रार्थना-समूह उभारा हुआ।', how: 'केवल वे समूह देखने के लिए लीजेंड में एक श्रेणी पर क्लिक करें। विवरण और प्रार्थना-लिंक के लिए किसी बिंदु पर क्लिक करें।' },
    'doxa-vision-card': { what: 'बचा हुआ काम एक कार्ड में: सभी जन-समूह, फिर अपहुँचे, फिर सीमांत, फिर DOXA प्रार्थना-समूह।', how: 'इसे ऊपर से नीचे पढ़ें। हर संख्या आँकड़ों से गणना की गई है, हाथ से नहीं लिखी गई।' },
    'pplr-data-maps': { what: 'जन-समूहों पर शोध-आँकड़े नक्शों पर: भाषा-परिवार, जन-क्लस्टर, धर्म और स्रोतों की पहुँच।', how: 'टैब से कोई दृश्य चुनें, फिर लीजेंड से किसी परिवार, क्लस्टर या धर्म को नक्शे पर उभारें।' },
    'wall-of-people-groups': { what: 'हर DOXA जन-समूह एक ही दीवार पर, उन्हें आशीष देने के लिए। आशीष मोड में दीवार छापने योग्य पोस्टर है (डिफ़ॉल्ट 5 × 8 फ़ुट), हर समूह के साथ आशीष का एक पद; सामाजिक मोड में यह एक साझा प्रार्थना दीवार है।', how: 'आशीष: पोस्टर को ठीक वैसा ही देखें जैसा वह छपेगा, आकार चुनें और HD पोस्टर छापें दबाएँ। सामाजिक: किसी समूह के लिए प्रार्थना करें, टिप्पणियाँ पढ़ें या लिखें, और उसका प्रार्थना पेज साझा करें।' },
  },
  zh: {
    'prayer-walk-planner': { what: '规划祷告行走：画出各小组要走的区域，把每个区域打印成一页地图。', how: '画一个区域并命名，选择需要的区域后点“打印”。每个区域连同坐标单独打印一页：每个小组一张地图。' },
    'gospel-internet': { what: '看看约 2,000 个族群中，哪些已经有母语的福音资源，以及互联网能把这些资源带到哪里。', how: '浏览语言树、有界集与中心集以及地图。在侧边选择一个名单，可缩小每个视图的范围。' },
    'country-posters': { what: '可打印的祷告海报，每个国家一张，列出其中的族群。', how: '在海报列表或地图上选择一个国家，然后直接从浏览器打印。' },
    'all-people-groups': { what: '世界上所有族群都在一张地图上，按福音进展着色，并突出显示 DOXA 祷告名单。', how: '点击图例中的类别，只显示这些族群。点击一个点，查看详情和祷告链接。' },
    'doxa-vision-card': { what: '一张卡片看清剩下的使命：所有族群，然后是未得之民，再是前沿族群，最后是 DOXA 祷告名单。', how: '从上往下读。每个数字都由数据计算得出，而不是手工填写。' },
    'pplr-data-maps': { what: '族群研究数据地图：语系、民族集群、宗教和数据来源覆盖情况。', how: '在标签页中选择一个视图，然后用图例在地图上突出显示某个语系、集群或宗教。' },
    'wall-of-people-groups': { what: '所有 DOXA 族群都在一面墙上，为要祝福他们。在“祝福”模式下，这面墙就是可打印的海报（默认 5 × 8 英尺），每个族群配一节祝福经文；在“社交”模式下，它是一面共同的祷告墙。', how: '祝福：按打印时的样子浏览海报，选择尺寸，然后点击“打印高清海报”。社交：为某个族群祷告，阅读或留下评论，并分享它的祷告页面。' },
  },
}

export function helpFor(bundleId, locale) {
  const base = String(locale || 'en').toLowerCase().split(/[-_]/)[0]
  return EXPERIMENTAL_HELP[base]?.[bundleId] || EXPERIMENTAL_HELP.en[bundleId] || null
}
