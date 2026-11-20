"""Kit thumbnails (RUNBOOK §6w, Robin 20 Nov 2026: "add thumbnails, so the pages look less like just text").

Every product link on the site gets a small drawn picture of the TYPE of thing it is (a boot, binoculars, a head
torch), made by us and written by build.py into static/kit-icons.svg as one sprite. They are illustrations of the
kind of item, never of a particular product: the house rules allow only our own artwork, open-licence Commons
photos or photos with written permission, and Amazon's terms allow its product photos only through its Product
Advertising API. If product photos ever come through that API, they replace these per product.

icon_for(name) picks the icon from the product's name; the first rule that matches wins, so specific rules come
before general ones. Anything unmatched gets the plain tag icon. To add an icon: draw it on a 48x48 grid with
strokes only (the sprite sets stroke, width and joins), add it to ICONS and a rule to RULES, rebuild, and look at
/kit/ and an activity page.
"""
import re
from pathlib import Path

# Shapes on a 48 x 48 grid. "f" marks a soft-filled shape (drawn at low opacity behind the strokes).
ICONS = {
    "binoculars": '<rect class="f" x="6" y="18" width="15" height="23" rx="6"/><rect class="f" x="27" y="18" width="15" height="23" rx="6"/><path d="M9 18v-5a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v5M30 18v-5a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v5M21 25h6"/><circle cx="13.5" cy="34" r="3.5"/><circle cx="34.5" cy="34" r="3.5"/>',
    "telescope": '<path class="f" d="M7 23l25-12 4.5 9.5-25 12z"/><path d="M36.5 20.5l4-2-4.5-9.5-4 2M22 27l-8 15M22 27l8 15M22 27v15"/>',
    "boot": '<path class="f" d="M12 5h13v18l10.5 3.6c3.5 1.2 5.5 3.6 5.5 7V38H7v-8l5-3z"/><path d="M7 38v3.5h34V38M25 10.5h-5M25 15.5h-5M25 20.5h-5M7 33h34"/>',
    "shoe": '<path class="f" d="M5 33c0-5 1.5-10 4-14l4.5 3c3 2 6 2 8.5 0l3-4c4 6 10 9.5 15.5 10.5 2 .4 3.5 2 3.5 4V36H5z"/><path d="M5 36v3.5h39V36M18 25.5l2 3M22.5 23l2 3M5 31h39"/>',
    "jacket": '<path class="f" d="M18 6l-8 4-5 15 5 2v15h28V27l5-2-5-15-8-4c-1 3.5-3.4 5.5-6 5.5S19 9.5 18 6z"/><path d="M24 11.5V42M14 31h5M29 31h5"/>',
    "trousers": '<path class="f" d="M13 6h22l3.5 36h-9.5L24 19l-5 23H9.5z"/><path d="M13 11h22M24 11v8"/>',
    "top": '<path class="f" d="M17 6L6 12l4 8 5-2v24h18V18l5 2 4-8-11-6c-1 3-3.6 5-7 5s-6-2-7-5z"/>',
    "vest": '<path class="f" d="M17 6l-7 4v31h28V10l-7-4c-1 4-3.6 6.5-7 6.5S18 10 17 6z"/><path d="M10 22h28M10 31h28M24 12.5V41"/>',
    "poles": '<path d="M14.5 13l6 29M33.5 13l-6 29M14 35h9M25 35h9"/><rect class="f" x="10.5" y="4" width="8" height="10" rx="3.5"/><rect class="f" x="29.5" y="4" width="8" height="10" rx="3.5"/>',
    "headtorch": '<ellipse cx="24" cy="29" rx="18" ry="8"/><rect class="f" x="15.5" y="18.5" width="17" height="14" rx="4"/><circle cx="24" cy="25.5" r="4"/><path d="M24 13V7.5M15 14.5l-3.5-3.5M33 14.5l3.5-3.5"/>',
    "torch": '<rect class="f" x="5" y="20" width="19" height="9" rx="2.5"/><path class="f" d="M24 18l8-4v21l-8-4z"/><path d="M36 18.5l6.5-3M37 24.5h6.5M36 30.5l6.5 3M11 24.5h6"/>',
    "helmet": '<path class="f" d="M5 31c0-11.5 8.5-20 20-20 9.5 0 17 6.5 18 16z"/><path d="M14 18.5l5 10M22 14.5l2.5 12.5M31 14v12M5 31l-.5 4.5h9"/>',
    "plaster": '<g transform="rotate(-35 24 24)"><rect class="f" x="5" y="16.5" width="38" height="15" rx="7.5"/><rect x="17" y="16.5" width="14" height="15"/><path d="M10 22v4M38 22v4"/></g>',
    "firstaid": '<rect class="f" x="6" y="13" width="36" height="28" rx="4"/><path d="M18 13V8.5h12V13M24 20.5v13M17.5 27h13"/>',
    "bottle": '<path class="f" d="M19 4h10v5.5l3 4V42a2 2 0 0 1-2 2H18a2 2 0 0 1-2-2V13.5l3-4z"/><path d="M16 21h16M16 35h16M19 9.5h10"/>',
    "mug": '<path class="f" d="M9 15h23v20a6.5 6.5 0 0 1-6.5 6.5h-10A6.5 6.5 0 0 1 9 35z"/><path d="M32 19.5h4a5.5 5.5 0 0 1 0 11h-4M15 9c0-2 2-2 2-4M22 9c0-2 2-2 2-4"/>',
    "wine": '<path class="f" d="M14.5 5h19c0 11-3.5 17.5-9.5 17.5S14.5 16 14.5 5z"/><path d="M24 22.5V40M16.5 42.5h15M15.5 11h17"/>',
    "drybag": '<path class="f" d="M14 15h20l2.5 25a3 3 0 0 1-3 3.3H14.5a3 3 0 0 1-3-3.3z"/><path d="M12 9h24v6H12zM19 9c0-3 2.4-5 5-5s5 2 5 5M15 26h18"/>',
    "bag": '<rect class="f" x="10.5" y="12" width="27" height="31" rx="7"/><path d="M18 12V8.5a6 6 0 0 1 12 0V12M10.5 22h27"/><rect x="16" y="28.5" width="16" height="9.5" rx="2"/>',
    "sock": '<path class="f" d="M16 4h12v20l9.5 8.5c3 2.7 3.3 7.6.3 10-3 2.5-7 1.6-9.3-.6L18.6 32.6A9 9 0 0 1 16 26.3z"/><path d="M16 10h12"/>',
    "hat": '<path class="f" d="M14 30c0-10 4-16.5 10-16.5S34 20 34 30"/><path d="M4 31c4 5.5 36 5.5 40 0-4-2-10-3-10-3H14s-6 1-10 3zM14 26h20"/>',
    "gloves": '<path class="f" d="M14 42V27l-5.5-7.5c-1.4-2 .8-4.4 3-3l4.5 4V9.5a2 2 0 0 1 4 0V19V6.5a2 2 0 0 1 4 0V19V7.5a2 2 0 0 1 4 0V19v-8.5a2 2 0 0 1 4 0V28c0 6-1.8 10-3.8 14z"/><path d="M14 36.5h16.5"/>',
    "glasses": '<circle class="f" cx="13.5" cy="27" r="8"/><circle class="f" cx="34.5" cy="27" r="8"/><path d="M21.5 26c1.4-1.8 3.6-1.8 5 0M5.8 24.5L3 16.5M42.2 24.5l2.8-8"/>',
    "chair": '<path class="f" d="M12 7h24v15H12z"/><path d="M9 24h30l-2 5H11zM14 29l-4 13M34 29l4 13M14 29l20 13M34 29L14 42"/>',
    "notebook": '<rect class="f" x="11" y="5" width="28" height="38" rx="3"/><path d="M17.5 5v38M7.5 12h6M7.5 20h6M7.5 28h6M7.5 36h6M23.5 15h10.5M23.5 21h10.5M23.5 27h7"/>',
    "book": '<path class="f" d="M24 12.5c-5-4-12-5-19-4v30c7-1 14 0 19 4 5-4 12-5 19-4v-30c-7-1-14 0-19 4z"/><path d="M24 12.5v30M10 16.5c3.5-.4 7 .3 10 2M10 23c3.5-.4 7 .3 10 2M28 18.5c3-1.7 6.5-2.4 10-2M28 25c3-1.7 6.5-2.4 10-2"/>',
    "compass": '<rect class="f" x="12" y="4" width="24" height="40" rx="4"/><circle cx="24" cy="28" r="9"/><path d="M24 20.5l3 7.5-3 7.5-3-7.5zM24 8v8M21 11l3-3 3 3"/>',
    "map": '<path class="f" d="M5 11l12.5-4.5L31 11l12-4.5v31L31 42l-13.5-4.5L5 42z"/><path d="M17.5 6.5v31M31 11v31M9 22c3 0 4-3 7-3"/>',
    "star": '<path class="f" d="M24 5l5.5 11.5 12.5 1.5-9.2 8.8 2.4 12.5L24 33.3 12.8 39.3l2.4-12.5L6 18l12.5-1.5z"/>',
    "music": '<path d="M18 36V10.5l20-4.5v26M18 17l20-4.5"/><ellipse class="f" cx="12.5" cy="36" rx="6" ry="4.5"/><ellipse class="f" cx="32.5" cy="32" rx="6" ry="4.5"/>',
    "headphones": '<path d="M8 31v-7a16 16 0 0 1 32 0v7"/><rect class="f" x="5.5" y="27" width="9" height="14.5" rx="3.5"/><rect class="f" x="33.5" y="27" width="9" height="14.5" rx="3.5"/>',
    "mic": '<rect class="f" x="17.5" y="4" width="13" height="22" rx="6.5"/><path d="M11.5 21.5a12.5 12.5 0 0 0 25 0M24 34v8M17 42.5h14M17.5 12h4M17.5 17h4"/>',
    "camera": '<path class="f" d="M5 16h8.5l3-5h15l3 5H43v25H5z"/><circle cx="24" cy="27.5" r="7.5"/><path d="M36.5 21.5h2.5"/>',
    "watch": '<rect class="f" x="13.5" y="13.5" width="21" height="21" rx="6.5"/><path d="M18 13.5l1-9h10l1 9M18 34.5l1 9h10l1-9M24 18.5V24l3.5 3"/>',
    "power": '<rect class="f" x="7" y="14" width="31" height="20" rx="4"/><path d="M38 20h3.5v8H38M24.5 17l-5 8h6l-4 6.5"/>',
    "phone": '<rect class="f" x="14" y="4" width="20" height="40" rx="4"/><path d="M21 38h6M14 10h20M14 33h20"/>',
    "tech": '<rect class="f" x="9.5" y="9" width="29" height="21" rx="2"/><path d="M4 36h40l-3.5 4.5h-33zM9.5 30L4 36M38.5 30L44 36"/>',
    "bike": '<circle cx="11.5" cy="32" r="8"/><circle cx="36.5" cy="32" r="8"/><path d="M11.5 32h10.5l-4-14h13.5l5 14M22 32l9.5-14M11.5 32l6.5-14M15 18h6.5M31.5 18l-1.5-5.5h4.5"/>',
    "lock": '<rect class="f" x="10" y="21.5" width="28" height="21" rx="3.5"/><path d="M16 21.5V15a8 8 0 0 1 16 0v6.5M24 29v6"/>',
    "tube": '<path class="f" d="M14 11h20l-3 33H17z"/><path d="M17 4h14v4l-2 3H19l-2-3zM15.5 24h17M16.5 30h15"/>',
    "swim": '<path d="M4 34c4-3 8-3 12 0s8 3 12 0 8-3 12 0M4 42c4-3 8-3 12 0s8 3 12 0 8-3 12 0M9 28.5l10.5-8.5 8 5 8.5-4.5"/><circle class="f" cx="31" cy="14.5" r="4.5"/>',
    "mat": '<path class="f" d="M10 20h26a8 8 0 0 1 0 16H10"/><circle class="f" cx="10" cy="28" r="8"/><circle cx="10" cy="28" r="3"/><path d="M23 20v16"/>',
    "cook": '<path class="f" d="M8 19h32v15.5a8 8 0 0 1-8 8H16a8 8 0 0 1-8-8z"/><path d="M3.5 21.5H8M40 21.5h4.5M17 13c0-3 2-3 2-6M24 13c0-3 2-3 2-6M31 13c0-3 2-3 2-6"/>',
    "garden": '<rect class="f" x="20" y="4" width="8" height="12" rx="3.5"/><path d="M24 16v4"/><path class="f" d="M15.5 20h17v8.5c0 7.5-4 13-8.5 15.5-4.5-2.5-8.5-8-8.5-15.5z"/><path d="M24 25v12"/>',
    "plant": '<path class="f" d="M12 29h24l-3 14H15z"/><path d="M24 29V15M24 20c-6 0-10-3.5-11-10 6.5 0 10.5 3.5 11 10zM24 16c0-6 3.5-10 10-11 0 6.5-3.5 10.5-10 11zM10 29h28"/>',
    "tools": '<path class="f" d="M31 5.5a9.5 9.5 0 0 0-8.5 13L6.5 34.5a4.2 4.2 0 0 0 6 6l16-16A9.5 9.5 0 0 0 41.5 16l-5.5 5.5-6.5-2-2-6.5z"/>',
    "craft": '<path d="M37 5L12 41M33 10.5c-10 2-20.5 7.5-18.5 15.5s14.5 4 12.5 12S14 44 9 42"/><ellipse class="f" cx="35.5" cy="8" rx="2.4" ry="4.5" transform="rotate(35 35.5 8)"/>',
    "paint": '<path class="f" d="M33.5 5.5L42.5 14.5 27 30l-9-9z"/><path class="f" d="M17.5 23.5c-6 0-10 4-10 10 0 4-2 6-4 8 8.5 2 18.5 0 18.5-8.5"/>',
    "ball": '<circle class="f" cx="24" cy="24" r="18"/><path d="M6 24h36M24 6c-6.5 6-6.5 30 0 36M24 6c6.5 6 6.5 30 0 36"/>',
    "racket": '<ellipse class="f" cx="20" cy="18" rx="12" ry="13"/><path d="M28 28l12.5 14.5M14 10.5v15M20 6v24M26 10.5v15M9 15h22M9 21h22"/>',
    "target": '<circle class="f" cx="24" cy="24" r="18"/><circle cx="24" cy="24" r="11"/><circle cx="24" cy="24" r="4"/>',
    "paw": '<ellipse class="f" cx="24" cy="32" rx="8.5" ry="7.5"/><ellipse class="f" cx="11.5" cy="21.5" rx="3.5" ry="4.5"/><ellipse class="f" cx="18.5" cy="13" rx="3.5" ry="4.5"/><ellipse class="f" cx="29.5" cy="13" rx="3.5" ry="4.5"/><ellipse class="f" cx="36.5" cy="21.5" rx="3.5" ry="4.5"/>',
    "towel": '<rect class="f" x="8" y="9" width="32" height="31" rx="3"/><path d="M8 17h32M8 33h32M8 37h32"/>',
    "umbrella": '<path class="f" d="M4 24a20 20 0 0 1 40 0c-3-2-7-2-10 0-3-2-7-2-10 0-3-2-7-2-10 0-3-2-7-2-10 0z"/><path d="M24 24v14a4 4 0 0 1-8 0M24 3v1"/>',
    "whistle": '<circle class="f" cx="28" cy="28" r="10.5"/><path d="M28 17.5H5.5v8.5h12"/><circle cx="28" cy="28" r="3"/>',
    "lens": '<circle class="f" cx="20" cy="20" r="12.5"/><path d="M29 29l12.5 12.5M14 16a7 7 0 0 1 5-5"/>',
    "cards": '<rect class="f" x="7" y="10" width="20" height="28" rx="3" transform="rotate(-12 17 24)"/><rect class="f" x="21" y="10" width="20" height="28" rx="3" transform="rotate(10 31 24)"/><path d="M29.5 21l3 3.5-3 3.5-3-3.5z"/>',
    "instrument": '<path class="f" d="M19 22c-4.5-1.5-10 .5-11 6-1.2 6 3 11.5 9.5 13.5s12.5-.5 14-6c1-4-1.5-7.5-4.5-9 1-2.5.5-5-1.5-6.5s-5-1-6.5 2z"/><path d="M23 30.5L40 6.5M37 5l5 3.5M16.5 33.5l4 3"/><circle cx="20" cy="31" r="2.5"/>',
    "tent": '<path class="f" d="M24 7L4.5 41h39z"/><path d="M24 7v34M24 41l-6.5-12.5M24 41l6.5-12.5M2.5 41h43"/>',
    "pencil": '<path class="f" d="M33 6l9 9-24 24-11.5 2.5L9 30z"/><path d="M28 11l9 9M9 30l9 9"/>',
    "ticket": '<path class="f" d="M5 14h38v6a4 4 0 0 0 0 8v6H5v-6a4 4 0 0 0 0-8z"/><path d="M31 14v20" stroke-dasharray="3 3.5"/><path d="M12 21h12M12 27h8"/>',
    "tag": '<path class="f" d="M6 6h17.5L42 24.5 24.5 42 6 23.5z"/><circle cx="15" cy="15" r="3"/>',
}

# (pattern, icon): the first match wins. Patterns are matched against the lower-cased name.
RULES = [
    (r"\bhead ?torch|head-torch|red[- ]light head", "headtorch"),
    (r"\bhelmet|riding hat", "helmet"),
    (r"\blights?\b|\btorch|\blamp\b", "torch"),
    (r"spotting scope|telescope", "telescope"),
    (r"binocular", "binoculars"),
    (r"telephoto|zoom lens|macro lens|camera|tripod|webcam", "camera"),
    (r"hand lens|magnif", "lens"),
    (r"\bphone\b(?! charger)|phone mount|phone pouch", "phone"),
    (r"microphone|\bmic\b|pop filter|voice recorder|voice amplifier", "mic"),
    (r"power bank|charger|adaptor|adapter|plug\b|usb|energy monitor|battery", "power"),
    (r"watch\b|timer|pedometer|step counter|\bclock\b(?! repair)", "watch"),
    (r"\block\b", "lock"),
    (r"plaster|blister", "plaster"),
    (r"first aid|cpr|face shield", "firstaid"),
    (r"guitar|ukulele|violin|viola|cello|fiddle|recorder\b|harmonica|mouthpiece|practice mute|rosin|tabla|drum|cajon|cajón|bodhr|tin whistle|kalimba|\bpan sticks|instrument|tuning wrench|capo\b|plectrum|picks\b|strings\b|slide oil", "instrument"),
    (r"\bmusic|tuner|metronome|pitch pipe|reed case|valve oil|choir|\bcd\b", "music"),
    (r"headphone|earphone|earbud|ear defender|earplug|ear plug", "headphones"),
    (r"glasses|goggles|sunglasses|snorkel|\bmask\b", "glasses"),
    (r"\bgloves?\b|hand warmer|grippers|finger tab", "gloves"),
    (r"\bhats?\b|\bcap\b|beanie|head net", "hat"),
    (r"\bsocks?\b", "sock"),
    (r"\bboots?\b|wellington|gaiter|ice grip|booties", "boot"),
    (r"shoes?\b|trainers?\b|slippers|sneakers|plimsoll|elastic laces|shoe brush", "shoe"),
    (r"chair|stool|seat|cushion|kneeler", "chair"),
    (r"\bpoles?\b|\bstick\b", "poles"),
    (r"wetsuit|tow float|pull buoy|rash vest|swim|board leash|bodyboard|kite|surf", "swim"),
    (r"buoyancy|hi(gh)?[- ]vis|\bvest\b|bracer|arm guard|pads\b|guards\b|dobok|\bgi\b|uniform|mouthguard|wraps\b", "vest"),
    (r"jacket|poncho|fleece|raincoat|cagoule|mid layer", "jacket"),
    (r"trousers|shorts\b|overalls|tracksuit|joggers|leggings|skirt", "trousers"),
    (r"base ?layer|\btop\b|sportswear|jersey|shirt", "top"),
    (r"\bbike|tyre|cassette|cycl|pump|puncture|pannier|saddle|handlebar", "bike"),
    (r"bottle|flask|hydration|bladder|water filter", "bottle"),
    (r"\bmug\b|cup\b", "mug"),
    (r"wine|whisky|nosing glass|tasting glass", "wine"),
    (r"dry bag|dry sack|roll-top", "drybag"),
    (r"chef|kitchen|cook|pastry|espresso|thermometer|rice\b|recipe|stove|casserole|oven|preserving|jam |banneton|proving|baking|scales\b", "cook"),
    (r"sun ?cream|sunscreen|balm|repellent|chafe|lotion", "tube"),
    (r"sleeping|(?<!cutting )\bmats?\b|pillow|blanket|yoga block|yoga belt", "mat"),
    (r"robe|towel", "towel"),
    (r"umbrella", "umbrella"),
    (r"whistle", "whistle"),
    (r"\bdogs?\b|\bpaw|poo bag|treat pouch|\blead\b", "paw"),
    (r"trowel|spade|\bfork\b|garden|secateurs|soil|hose\b|pruning", "garden"),
    (r"compost|\bpots?\b|seeds?\b|bulbs?\b|bird feeder|bucket|herb", "plant"),
    (r"watercolou?r|gouache|pastel|paint|brush|easel|palette|pastels", "paint"),
    (r"needle|thimble|shuttles|seam ripper|spinning|weaving|crochet|sewing|embroider|yarn|knit|thread|tapestry", "craft"),
    (r"screwdriver|knife|tape measure|calipers|multi-tool|whetstone|hive tool|cutting mat|bone folder|scissors|measuring|spokeshave|spirit level|solder|cutters|pliers|abrasive|sandpaper|clamp|gauntlet|dowel|blanks\b|glue|grout|adhesive|squeegee|pottery tool|apron|smoker|chisel|saw\b|hammer|tool", "tools"),
    (r"\btent\b|bivvy|tarp\b|hammock", "tent"),
    (r"pencil|charcoal|chalk|\bink\b|paper|\bpad\b|pens?\b|calligraphy|nib|tracing|easel|canvas board|clay\b|tiles\b", "pencil"),
    (r"compass|planisphere|star wheel", "compass"),
    (r"star atlas|astronom", "star"),
    (r"\bmap\b|map case|road atlas", "map"),
    (r"notebook|journal|planner|sketchbook|scorebook|cue cards|folder|wallet|organiser|diary|flashcards|chart\b", "notebook"),
    (r"book|guide\b|dictionary|atlas|workbook|readers|complete works|shakespeare", "book"),
    (r"playing cards|board game|chess|games?\b", "cards"),
    (r"paddle|racket|racquet|\bbat\b|darts|disc\b|shuttlecock", "racket"),
    (r"\bballs?\b|softball|sliotar|netball|volleyball|futsal|football|bowls|shin (pads|guards)", "ball"),
    (r"quiver|archery|target", "target"),
    (r"laptop|keyboard|mouse|computer|calculator|card reader|kit\b(?=.*computer)", "tech"),
    (r"bag|rucksack|backpack|daypack|pouch|case\b|tote|belt|cool box|holdall", "bag"),
]
_COMPILED = [(re.compile(p), i) for p, i in RULES]


def icon_for(name):
    n = str(name or "").lower()
    for rx, icon in _COMPILED:
        if rx.search(n):
            return icon
    return "tag"


def sprite():
    """One SVG sprite: <symbol id="k-<icon>"> per icon. Colour comes from the page (currentColor)."""
    out = ['<svg xmlns="http://www.w3.org/2000/svg" style="display:none">',
           '<style>.f{fill:currentColor;fill-opacity:.16}</style>']
    for k, body in ICONS.items():
        out.append(f'<symbol id="k-{k}" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" '
                   f'stroke-linecap="round" stroke-linejoin="round">{body}</symbol>')
    out.append('</svg>')
    return "\n".join(out) + "\n"


def write_sprite(path):
    Path(path).write_text(sprite(), encoding="utf-8")


if __name__ == "__main__":
    # python3 tools/kiticons.py  → how every kit name on the site is matched, unmatched names last
    import collections, sys, yaml
    root = Path(__file__).resolve().parent.parent
    names = collections.Counter()
    for c in yaml.safe_load((root / "content/challenges.yaml").read_text()):
        for k in c.get("kit") or []:
            names[k["name"]] += 1
    by = collections.Counter()
    tags = []
    for n, v in names.items():
        i = icon_for(n)
        by[i] += v
        if i == "tag":
            tags.append((v, n))
    print(dict(by.most_common()))
    print(f"{sum(v for v, _ in tags)} of {sum(names.values())} kit links use the plain tag icon:")
    for v, n in sorted(tags, reverse=True)[: int(sys.argv[1]) if len(sys.argv) > 1 else 60]:
        print(v, n)
