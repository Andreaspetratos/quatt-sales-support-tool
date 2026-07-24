import type { Playbook, PlaybookInfo, Deal } from './types'
import { loadPbs, savePbs } from './storage'
import { CONFIG } from './config'

// ── Builtin playbook definitions ───────────────────────────────────────────────
// These are seeded into localStorage on first run.
export function getBuiltinPlaybookDefs(): Playbook[] {
  return [
    // ── HYBRID ────────────────────────────────────────────────────────────────
    {
      id: 'builtin-hybrid', isBuiltin: true,
      name: 'Hybrid Kwalificatiegesprek',
      productMatches: ['hybrid'],
      phases: [
        { id: 'bh_p1', label: 'Fase 1: Opening', questions: [
          { id: 'bh_open_s', type: 'script', content: '<strong>"Hoi [voornaam lead]"</strong>, je spreekt met <strong>[jouw naam]</strong> van Quatt. Ik bel je even kort omdat je je gegevens hebt achterlaten via <em>[form origin]</em>. Klopt dat?<br/><br/>Klant: Ja.<br/><br/><strong>Agent:</strong> "Top, dan heb ik de juiste persoon aan de lijn. Voor de kwaliteit nemen we dit gesprek op. Is dat oké voor je?"' },
          { id: 'bh_open_i', type: 'info', content: '👉 Als niet akkoord: stop opname in Aircall' },
        ]},
        { id: 'bh_p2', label: 'Fase 2: Koopintentie', questions: [
          { id: 'bh_doel', type: 'script', content: '<strong>Doel:</strong> bepaal in 2-3 vragen of de lead Hot / Warm / Cold is. Stop zodra je een duidelijk beeld hebt.' },
          { id: 'h_reden', type: 'choice', label: 'Wat was voor jou de belangrijkste reden om de besparingscheck in te vullen?', required: true, options: ['Ik wil van het gas af','Aan het rondkijken','CV-ketel moet worden vervangen','Kosten besparen','Renovatie','Verhuizing'] },
          { id: 'bh_ori_i', type: 'info', content: 'Vraag indien nodig:' },
          { id: 'h_orient_n', type: 'textarea', label: 'Wat heb je tot nu toe al gedaan in je oriëntatie?', placeholder: 'Notities…' },
          { id: 'h_timing', type: 'choice', label: 'Wanneer wil je de Hybrid in huis hebben?', options: ['ASAP','0-3 months','3-6 months','>6 months'] },
          { id: 'h_intent', type: 'intent', label: 'Is deze klant Hot, Warm of Cold?', required: true, hotDesc: 'Concrete aanleiding, timing ≤ 6 mnd → Fase 3.', warmDesc: 'Interesse aanwezig, oriënterend → Fase 3.', coldDesc: 'Lage urgentie → stuur informatiepakket, rond af.' },
        ]},
        { id: 'bh_p3', label: 'Fase 3: Tech check', questions: [
          { id: 'bh_tc_i', type: 'info', content: '🎯 <strong>Doel:</strong> harde disqualifiers uitvragen in zo min mogelijk vragen.<br/><strong>Agent:</strong> "Voordat ik de afspraak inplan, check ik even een paar technische punten. Dit helpt onze adviseur alvast ter voorbereiding."' },
          { id: 'h_gas_tc', type: 'tech_check', label: 'Check 1 — Gasverbruik', chipKey: 'h_gas', agentQuestion: 'Ik zie dat je [Deal: Aardgas] kuub gas hebt opgegeven als jaarlijks gasverbruik. Klopt dat?', outcomes: [
            { condition: 'Minder dan 700 m³', result: '✖ Lost', color: 'var(--rd)', script: '"Bij een verbruik onder de 700 m³ zien we vaak dat de terugverdientijd erg lang wordt. We willen eerlijk advies geven: in jouw geval is de investering technisch gezien prachtig, maar financieel minder rendabel. Ik wil je tijd niet verspillen met een afspraak die niets oplevert. Of zou het voor jou meer zijn voor het terugbrengen van je CO₂ uitstoot? Zo ja, dan plan ik gewoon een afspraak in!"' },
            { condition: 'Meer dan 700 m³', result: '✓ Ga door', color: 'var(--gr)' },
          ], chipOptions: ['Minder dan 700 m³ (Lost)','Meer dan 700 m³ (doorgaan)'] },
          { id: 'h_woning_tc', type: 'tech_check', label: 'Check 2 — Woning', chipKey: 'h_woning', agentQuestion: 'Dan nog even een paar snelle vragen over je woning: heb je een eigen woning met een cv-ketel?', outcomes: [
            { condition: 'Stadsverwarming', result: '✖ Lost', color: 'var(--rd)', script: '"Op dit moment werken onze systemen helaas nog niet met stadsverwarming. Mag ik je op een lijst zetten zodat je het als eerste hoort zodra we daar een oplossing voor hebben?"' },
            { condition: 'Geen buitenruimte', result: '✖ Lost', color: 'var(--rd)', script: '"Voor een warmtepomp hebben we buitenruimte nodig voor de buitenunit. In een appartement is dat helaas vaak niet mogelijk. Ik wil je geen afspraak laten inplannen die uiteindelijk niets oplevert."' },
            { condition: 'Renovatie', result: '⏸ On hold', color: '#f59e0b', script: '"Omdat een warmtepomp nauwkeurig moet worden ingeregeld op een werkend systeem, kunnen we je op dit moment helaas nog niet verder helpen. We willen namelijk voorkomen dat je verbouwing vastloopt op de installatie."' },
            { condition: 'Cv-ketel / radiatoren / vloerverwarming', result: '✓ Ga door', color: 'var(--gr)' },
          ], chipOptions: ['Ja — radiatoren/vloerverwarming','Stadsverwarming (Lost)','Geen buitenruimte (Lost)','Renovatie (On hold)'] },
          { id: 'h_tech_n', type: 'textarea', label: 'Notities tech check', placeholder: 'Notities…' },
        ]},
        { id: 'bh_p4', label: 'Fase 4: Afsluiting', questions: [
          { id: 'bh_close_s', type: 'script', content: '<strong>Agent:</strong> "Leuk! Laten we direct een afspraak inplannen. Ik kijk met je mee wanneer wij een mogelijkheid hebben."<br/><br/><strong>Actie:</strong> 1. Check of postcode en adres in het systeem staat. Zo niet, vraag deze op en vul ze in. 2. Klik in \'Call outcome\' op Plan HV.' },
          { id: 'bh_close_i', type: 'info', content: '📞 Als de klant veel haast heeft of liever een video call wil: probeer via Aircall door te verbinden naar een Account Manager. Lukt dit niet, plan de afspraak via de Call Scheduler.' },
          { id: 'bh_addr', type: 'address', prefix: 'h_' },
          { id: 'h_owner', type: 'textarea', label: 'Vul hier je naam in (Qualification-call-owner)', placeholder: 'Jouw naam…' },
          { id: 'bh_out', type: 'outcome', prefix: 'h_', altProdNote: 'Als de lead een ander product wil, pas "Selected Product" aan in HubSpot.' },
        ]},
      ],
    },

    // ── ALL-ELECTRIC ──────────────────────────────────────────────────────────
    {
      id: 'builtin-all-electric', isBuiltin: true,
      name: 'All-Electric Kwalificatiegesprek',
      productMatches: ['all-electric', 'all electric'],
      phases: [
        { id: 'ae_p1', label: 'Fase 1: Opening', questions: [
          { id: 'ae_open_s', type: 'script', content: '<strong>"Hoi [voornaam lead]"</strong>, je spreekt met <strong>[jouw naam]</strong> van Quatt. Ik bel je even kort omdat je je gegevens hebt achterlaten via <em>[form origin]</em>. Klopt dat?<br/><br/>Klant: Ja.<br/><br/><strong>Agent:</strong> "Top, dan heb ik de juiste persoon aan de lijn. Voor de kwaliteit nemen we dit gesprek op. Is dat oké voor je?"' },
          { id: 'ae_open_i', type: 'info', content: '👉 Als niet akkoord: stop opname in Aircall' },
        ]},
        { id: 'ae_p2', label: 'Fase 2: Koopintentie', questions: [
          { id: 'ae_doel', type: 'script', content: '<strong>Doel:</strong> bepaal in 2-3 vragen of de lead Hot / Warm / Cold is. Stop zodra je een duidelijk beeld hebt.' },
          { id: 'ae_reden', type: 'choice', label: 'Wat was voor jou de belangrijkste reden om de besparingscheck in te vullen?', required: true, options: ['Ik wil van het gas af','Ik heb al een Quatt Hybrid en wil naar de volgende stap','Aan het rondkijken','CV-ketel moet worden vervangen','Kosten besparen','Renovatie','Verhuizing'] },
          { id: 'ae_ori_i', type: 'info', content: 'Vraag indien nodig:' },
          { id: 'ae_orient_n', type: 'textarea', label: 'Wat heb je tot nu toe al gedaan in je oriëntatie?', placeholder: 'Notities…' },
          { id: 'ae_timing', type: 'choice', label: 'Wanneer wil je de All-Electric in huis hebben?', options: ['ASAP','0-3 months','3-6 months','>6 months'] },
          { id: 'ae_intent', type: 'intent', label: 'Is deze klant Hot, Warm of Cold?', required: true, hotDesc: 'Concrete aanleiding, timing ≤ 6 mnd → Fase 3.', warmDesc: 'Interesse aanwezig, oriënterend → Fase 3.', coldDesc: 'Lage urgentie → stuur informatiepakket, rond af.' },
        ]},
        { id: 'ae_p3', label: 'Fase 3: Tech check', questions: [
          { id: 'ae_tc_i', type: 'info', content: '🎯 <strong>Doel:</strong> harde disqualifiers uitvragen in zo min mogelijk vragen.<br/><strong>Agent:</strong> "Voordat ik de afspraak inplan, check ik even een paar technische punten."' },
          { id: 'ae_gas_tc', type: 'tech_check', label: 'Check 1 — Gasverbruik', chipKey: 'ae_gas', agentQuestion: 'Ik zie dat je [Deal: Aardgas] kuub gas hebt opgegeven als jaarlijks gasverbruik. Klopt dat?', outcomes: [
            { condition: 'Minder dan 700 m³', result: '✖ Lost', color: 'var(--rd)', script: '"Bij een verbruik onder de 700 m³ zien we vaak dat de terugverdientijd erg lang wordt."' },
            { condition: '700–2000 m³', result: '✓ Ga door', color: 'var(--gr)' },
            { condition: 'Meer dan 2000 m³', result: '→ Plan Hybrid', color: 'var(--or)', script: '"Super, dan gaan we voor je kijken of de Hybrid Single of Hybrid Duo beter past — dat systeem is voor woningen met meer gasverbruik."' },
          ], chipOptions: ['Minder dan 700 m³ (Lost)','700–2000 m³ (doorgaan)','Meer dan 2000 m³ (naar Hybrid)'] },
          { id: 'ae_woning_tc', type: 'tech_check', label: 'Check 2 — Woning', chipKey: 'ae_woning', agentQuestion: 'Dan nog even een paar snelle vragen over je woning: heb je een eigen woning met een cv-ketel?', outcomes: [
            { condition: 'Stadsverwarming', result: '✖ Lost', color: 'var(--rd)', script: '"Op dit moment werken onze systemen helaas nog niet met stadsverwarming."' },
            { condition: 'Geen buitenruimte', result: '✖ Lost', color: 'var(--rd)', script: '"Voor een warmtepomp hebben we buitenruimte nodig voor de buitenunit."' },
            { condition: 'Renovatie', result: '⏸ On hold', color: '#f59e0b', script: '"Omdat een warmtepomp nauwkeurig moet worden ingeregeld op een werkend systeem, kunnen we je op dit moment helaas nog niet verder helpen."' },
            { condition: 'Cv-ketel / radiatoren / vloerverwarming', result: '✓ Ga door', color: 'var(--gr)' },
          ], chipOptions: ['Ja — radiatoren/vloerverwarming','Stadsverwarming (Lost)','Geen buitenruimte (Lost)','Renovatie (On hold)'] },
          { id: 'ae_tech_n', type: 'textarea', label: 'Notities tech check', placeholder: 'Notities…' },
        ]},
        { id: 'ae_p4', label: 'Fase 4: Afsluiting', questions: [
          { id: 'ae_close_s', type: 'script', content: '<strong>Agent:</strong> "Leuk! Laten we direct een afspraak inplannen."<br/><br/><strong>Actie:</strong> 1. Check of postcode en adres in het systeem staat. Zo niet, vraag deze op en vul ze in. 2. Klik in \'Call outcome\' op Plan HV.' },
          { id: 'ae_close_i', type: 'info', content: '📞 Als de klant veel haast heeft of liever een video call wil: probeer via Aircall door te verbinden naar een Account Manager.' },
          { id: 'ae_addr', type: 'address', prefix: 'ae_' },
          { id: 'ae_owner', type: 'textarea', label: 'Vul hier je naam in (Qualification-call-owner)', placeholder: 'Jouw naam…' },
          { id: 'ae_out', type: 'outcome', prefix: 'ae_', altProdNote: 'Als de lead een ander product dan All-Electric wil, pas "Selected Product" aan in HubSpot.' },
        ]},
      ],
    },

    // ── CHILL ─────────────────────────────────────────────────────────────────
    {
      id: 'builtin-chill', isBuiltin: true,
      name: 'Chill Kwalificatiegesprek',
      productMatches: ['chill'],
      phases: [
        { id: 'c_p1', label: 'Fase 1: Opening', questions: [
          { id: 'c_open_s', type: 'script', content: '<strong>"Hoi [voornaam lead]"</strong>, je spreekt met <strong>[jouw naam]</strong> van Quatt. Ik bel je even kort omdat je je gegevens hebt achterlaten via <em>[form origin]</em>. Klopt dat?<br/><br/>Klant: Ja.<br/><br/><strong>Agent:</strong> "Top, dan heb ik de juiste persoon aan de lijn. Voor de kwaliteit nemen we dit gesprek op. Is dat oké voor je?"' },
          { id: 'c_open_i', type: 'info', content: '👉 Als niet akkoord: stop opname in Aircall' },
        ]},
        { id: 'c_p2', label: 'Fase 2: Inventarisatie', questions: [
          { id: 'c_doel', type: 'script', content: '<strong>Doel:</strong> snel begrijpen waar de lead naar zoekt, hoeveel productkennis er al is, en of de lead vooral comfort, besparing of beide zoekt.' },
          { id: 'c_reden', type: 'choice', label: 'Wat was voor jou de belangrijkste reden om de besparingscheck in te vullen?', required: true, options: ['Renovatie of verhuizing','Aan het rondkijken','CV-ketel moet worden vervangen','Kosten besparen','Verduurzamen van de woning'] },
          { id: 'c_comfort_n', type: 'textarea', label: 'Waar merk je thuis vooral dat het niet comfortabel is? Te warme kamers in de zomer, lastig warm worden in de winter, of allebei?', placeholder: 'Notities…' },
          { id: 'c_ruimte', type: 'choice', label: 'Om welke ruimte of ruimtes gaat het dan vooral?', options: ['Slaapkamer','Woonkamer','Zolder','Anders'] },
          { id: 'c_curr', type: 'choice', label: 'Heb je daar nu al iets voor, zoals een mobiele airco, ventilator, split-airco of extra verwarming?', options: ['Mobiele airco','Ventilator','Split-airco','Extra verwarming','Nog niks'] },
          { id: 'c_scenario', type: 'choice', label: 'Wat zocht je vooral toen je de aanvraag deed?', options: ['Scenario A — Klant kent Chill nog niet','Scenario B — Klant kent basisprincipe al'] },
        ]},
        { id: 'c_p3', label: 'Fase 3: Educatie & Positionering', questions: [
          { id: 'c_edu_sa', type: 'script', content: '<strong>Scenario A — Klant kent Chill nog niet</strong><br/><br/><strong>Agent:</strong> "Onze airco heet \'Chill\' en Chill werkt nét iets anders dan een standaard split-airco."<br/><br/><strong>1. Eén buitenunit voor twee functies:</strong> "Dat verschil zit vooral in de dubbele functie van het buitendeel: dat is namelijk een airco én warmtepomp in één systeem."<br/><br/><strong>2. Koelen + besparen:</strong> "In de zomer gebruik je Chill om te koelen, maar in de winter gebruik je het buitendeel om mee te helpen met verwarmen. Daardoor bespaar je op je gasverbruik."<br/><br/><strong>3. Geen nieuw leidingwerk binnen:</strong> "Omdat Chill samenwerkt met je bestaande verwarmingssysteem hoeven we geen nieuwe aircoleidingen door het hele huis te trekken."<br/><br/><strong>4. Flexibel gebruik:</strong> "Het binnendeel kun je zelf loskoppelen en verplaatsen."<br/><br/><strong>5. Koelen én verwarmen:</strong> "Net als met de meeste split-airco\'s tegenwoordig kun je met Chill ook zowel koelen als verwarmen."' },
          { id: 'c_edu_sb', type: 'script', content: '<strong>Scenario B — Klant kent basisprincipe al</strong><br/><br/><strong>Agent:</strong> "Super dat je al weet hoe Chill werkt. Dan kunnen we direct kijken wat de beste oplossing is voor jouw situatie."<br/><br/>Stel gericht door: hoeveel ruimtes, wanneer installatie, welk budget?' },
          { id: 'c_edu_n', type: 'textarea', label: 'Notities educatie & positionering', placeholder: 'Notities…' },
        ]},
        { id: 'c_p4', label: 'Fase 4: Afsluiting', questions: [
          { id: 'c_close_s', type: 'script', content: '<strong>Agent:</strong> "Leuk! Laten we direct een afspraak inplannen."<br/><br/><strong>Actie:</strong> 1. Check of postcode en adres in het systeem staat. 2. Klik in \'Call outcome\' op Plan HV.' },
          { id: 'c_close_i', type: 'info', content: '📞 Als de klant veel haast heeft of liever een video call wil: probeer via Aircall door te verbinden naar een Account Manager.' },
          { id: 'c_addr', type: 'address', prefix: 'c_' },
          { id: 'c_owner', type: 'textarea', label: 'Vul hier je naam in (Qualification-call-owner)', placeholder: 'Jouw naam…' },
          { id: 'c_out', type: 'outcome', prefix: 'c_', altProdNote: '' },
        ]},
      ],
    },

    // ── HOMEBATTERY ───────────────────────────────────────────────────────────
    {
      id: 'builtin-homebattery', isBuiltin: true,
      name: 'HomeBattery Kwalificatiegesprek',
      productMatches: ['homebattery', 'home battery', 'home-battery'],
      phases: [
        { id: 'hb_p1', label: 'Fase 1: Opening', questions: [
          { id: 'hb_open_s', type: 'script', content: '<strong>"Hoi [voornaam lead]"</strong>, je spreekt met <strong>[jouw naam]</strong> van Quatt. Ik bel je even kort omdat je je gegevens hebt achterlaten via <em>[form origin]</em>. Klopt dat?<br/><br/>Klant: Ja.<br/><br/><strong>Agent:</strong> "Top, dan heb ik de juiste persoon aan de lijn. Voor de kwaliteit nemen we dit gesprek op. Is dat oké voor je?"' },
          { id: 'hb_open_i', type: 'info', content: '👉 Als niet akkoord: stop opname in Aircall' },
        ]},
        { id: 'hb_p2', label: 'Fase 2: Koopintentie', questions: [
          { id: 'hb_doel', type: 'script', content: '<strong>Doel:</strong> bepaal in 2-3 vragen of de lead Hot / Warm / Cold is en wat de aanleiding is voor de HomeBattery interesse.' },
          { id: 'hb_reden', type: 'choice', label: 'Wat was voor jou de belangrijkste reden om de aanvraag in te vullen?', required: true, options: ['Aan het rondkijken','Kosten besparen','Netcongestie verminderen','Zonnestroom opslaan'] },
          { id: 'hb_orient_n', type: 'textarea', label: 'Wat heb je tot nu toe al gedaan in je oriëntatie?', placeholder: 'Notities…' },
          { id: 'hb_timing', type: 'choice', label: 'Wanneer wil je de HomeBattery in huis hebben?', options: ['ASAP','0-3 months','3-6 months','>6 months'] },
          { id: 'hb_intent', type: 'intent', label: 'Is deze klant Hot, Warm of Cold?', required: true, hotDesc: 'Concrete aanleiding, timing ≤ 6 mnd → Plan afspraak.', warmDesc: 'Vergelijkt actief, wil binnenkort beslissen → Plan afspraak.', coldDesc: 'Lage urgentie → stuur informatiepakket, rond af.' },
        ]},
        { id: 'hb_p3', label: 'Fase 3: Inplannen & Afronden', questions: [
          { id: 'hb_close_s', type: 'script', content: '<strong>Agent:</strong> "Leuk! Laten we direct een afspraak inplannen."<br/><br/><strong>Actie:</strong> 1. Check of postcode en adres in het systeem staat. 2. Klik in \'Call outcome\' op Plan HV.' },
          { id: 'hb_close_i', type: 'info', content: '📞 Als de klant veel haast heeft of liever een video call wil: probeer via Aircall door te verbinden naar een Account Manager.' },
          { id: 'hb_addr', type: 'address', prefix: 'hb_' },
          { id: 'hb_owner', type: 'textarea', label: 'Vul hier je naam in (Qualification-call-owner)', placeholder: 'Jouw naam…' },
          { id: 'hb_out', type: 'outcome', prefix: 'hb_', altProdNote: '' },
        ]},
      ],
    },
  ]
}

// ── Seed builtins into localStorage (idempotent) ───────────────────────────────
export function seedBuiltinPlaybooks(): void {
  const existing = loadPbs()
  const builtins = getBuiltinPlaybookDefs()
  const toAdd = builtins.filter(b => !existing.some(e => e.id === b.id))
  if (!toAdd.length) return
  try {
    savePbs([...existing, ...toAdd])
  } catch (e) {
    console.warn('Could not seed built-in playbooks', e)
  }
}

// ── Get matching playbooks for a deal ─────────────────────────────────────────
export function getPlaybookDefs(deal: Deal, customs?: Playbook[]): PlaybookInfo[] {
  const prod = (deal?.properties?.[CONFIG.PROPS.product] || '').toLowerCase()
  if (!customs) customs = loadPbs()
  const results: PlaybookInfo[] = []

  customs.forEach(p => {
    if (p.productMatches && p.productMatches.some(x => prod.includes(x.toLowerCase()))) {
      results.push({ type: 'custom', key: p.id, def: p })
    }
  })
  if (results.length > 0) return results

  // Fallback: use builtin defs directly (no localStorage needed)
  const builtins = getBuiltinPlaybookDefs()
  const fallbacks: PlaybookInfo[] = []
  if (prod.includes('all-electric') || prod.includes('all electric')) {
    const d = builtins.find(b => b.id === 'builtin-all-electric')
    if (d) fallbacks.push({ type: 'custom', key: d.id, def: d })
  }
  if (prod.includes('homebattery') || prod.includes('home battery') || prod.includes('home-battery')) {
    const d = builtins.find(b => b.id === 'builtin-homebattery')
    if (d) fallbacks.push({ type: 'custom', key: d.id, def: d })
  }
  if (prod.includes('chill')) {
    const d = builtins.find(b => b.id === 'builtin-chill')
    if (d) fallbacks.push({ type: 'custom', key: d.id, def: d })
  }
  if (prod.includes('hybrid')) {
    const d = builtins.find(b => b.id === 'builtin-hybrid')
    if (d) fallbacks.push({ type: 'custom', key: d.id, def: d })
  }
  if (fallbacks.length > 0) return fallbacks

  // Default: hybrid
  const defaultPb = builtins.find(b => b.id === 'builtin-hybrid')!
  return [{ type: 'custom', key: defaultPb.id, def: defaultPb }]
}

export function getScheduler(deal: Deal | undefined) {
  const scheds = loadPbs() // handled separately via loadScheds
  // This is handled in the component directly with loadScheds
  return null
}
