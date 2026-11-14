# Popular companies by sector — research for Winnow's Companies page

Prepared 3 November 2026. Purpose: a starter catalogue so Winnow can say "we've seen you look at _Finance_;
these are the biggest hirers in that sector, do you want to track their job pages?"

## How to read this (method and limits)

- **What "top hirer" means here.** A blend of three things: (1) size of workforce, (2) how continuously the company
  posts new roles (volume, not just prestige), and (3) whether it has a public careers page that can be monitored.
  Companies that mostly hire through agencies or have no public job page are noted or left out.
- **Evidence.** Web searches this session confirmed the headline facts I rely on (below). The per-sector rankings are
  **editorial judgement from public knowledge, not audited headcounts.** No source I could reach publishes a clean
  "top 20 hirers by sector" list, and the headcount tables I found were mostly SEO aggregators with conflicting figures.
  Treat the order inside a sector as roughly tiered, not exact. Membership (is this a big hirer here?) is more reliable
  than rank.
- **Not verified yet:** each company's careers URL and which job system (Workday, Greenhouse, Lever, Taleo,
  SuccessFactors, own site…) it uses. That is the next step before anything goes into the app (see "Next steps").
- **Overlap is expected.** A company appears in every sector it is a top hirer in (e.g. Amazon: Technology, Retail,
  Logistics, Cloud). Section 3 lists the most-repeated names.
- **HQ in brackets** is a starting point for the location lens. Hiring location is wider (see Section 2).
- **Agencies are excluded** (Randstad, Adecco, Hays, etc.), matching Winnow's existing agency flag.

### Facts confirmed by search this session

- Amazon took the #1 spot on the 2026 Fortune 500 from Walmart; UnitedHealth Group, Apple and Alphabet follow
  ([Fortune, June 2026](https://fortunemedia.mediaroom.com/2026-06-03-Amazon-Claims-No-1-Spot-on-the-Fortune-500)).
- Walmart (~2.1M staff) and Amazon (~1.5M) are the two largest private employers; Accenture (~742k) and DHL Group
  (~590k) are the largest in their fields ([Analytics Insight](https://www.analyticsinsight.net/business/10-largest-companies-in-2026-ranked-by-number-of-employees)).
- Financials is the biggest sector on the 2026 Global 500 (123 companies), energy second (77)
  ([Houston Innovation Map](https://houston.innovationmap.com/fortune-global-500-2677723978.html)).
- Healthcare employers by headcount: UnitedHealth ~400k, HCA ~226k, CVS ~219k, Elevance ~104k
  ([Xtalks, 2026](https://xtalks.com/top-30-largest-publicly-traded-healthcare-companies-in-2026-by-employee-number-4698/)).
- JPMorgan Chase had 318,512 staff at end 2025 ([Yahoo Finance](https://finance.yahoo.com/markets/stocks/articles/many-employees-does-jpmorgan-chase-001132736.html)).
- **Market conditions matter for "hiring":** 2026 has had heavy tech layoffs (Amazon ~16k in January, Oracle,
  Dell ~11k, Meta), while AI labs are expanding: OpenAI planned to grow from ~4,500 to ~8,000
  ([Fortune, March 2026](https://fortune.com/2026/03/21/openai-double-headcount-this-year-sam-altman-anthropic-google/)).
  Big tech is therefore "large and always posting" but not "growing". Flagged per sector where it matters.
- Aid/NGO sector is contracting: ICRC planning ~2,900 post cuts, UNICEF forecasting ~20% lower funding
  ([Devex](https://www.devex.com/news/the-top-global-development-employers-of-2025-112008)). Those lists are still
  the biggest posters, but expect fewer roles.
- UK graduate hiring is at its lowest since 2012; PwC and Deloitte remain the top private-sector graduate destinations
  ([City AM](https://www.cityam.com/?p=2402611), [Times Top 100](https://top100graduateemployers.com/)).
- Forbes World's Best Employers 2026 (Microsoft #1, then Delta, Shopify, Costco, NVIDIA) is useful as a
  quality-of-employer signal, not a volume one ([Inside IIM](https://insideiim.com/forbes-worlds-best-employers-2026-top-50-companies-revealed)).

---

# 1. Sector list (41 sectors)

| #   | Sector                                | #   | Sector                                               |
| --- | ------------------------------------- | --- | ---------------------------------------------------- |
| 1   | Software & Cloud                      | 22  | Higher Education                                     |
| 2   | Internet, Social & Consumer Tech      | 23  | EdTech, Training & K-12 Services                     |
| 3   | AI & Machine Learning                 | 24  | International Development & Humanitarian NGOs        |
| 4   | Semiconductors & Hardware             | 25  | Charities, Fundraising & Grant-making (Third Sector) |
| 5   | IT Services & Outsourcing             | 26  | UN & Multilateral Organisations                      |
| 6   | Cybersecurity                         | 27  | Government & Public Sector                           |
| 7   | Telecoms                              | 28  | Defence & Aerospace                                  |
| 8   | Retail & Commercial Banking           | 29  | Airlines & Aviation                                  |
| 9   | Investment Banking & Asset Management | 30  | Automotive & EV                                      |
| 10  | Fintech, Payments & Crypto            | 31  | Oil, Gas & Energy Majors                             |
| 11  | Insurance                             | 32  | Renewables, Utilities & Climate                      |
| 12  | Accounting, Audit & Tax               | 33  | Industrial Manufacturing                             |
| 13  | Management Consulting & Strategy      | 34  | Construction, Engineering & Infrastructure           |
| 14  | Legal                                 | 35  | Real Estate & PropTech                               |
| 15  | Healthcare Providers                  | 36  | Retail & E-commerce                                  |
| 16  | Pharmaceuticals                       | 37  | Consumer Goods (FMCG)                                |
| 17  | Biotech, Life-science Tools & CROs    | 38  | Food, Beverage & Agriculture                         |
| 18  | Medical Devices                       | 39  | Hospitality, Travel & Leisure                        |
| 19  | Health Insurance & Digital Health     | 40  | Logistics, Shipping & Supply Chain                   |
| 20  | Media, Publishing & Entertainment     | 41  | Business Services, Facilities & Outsourcing          |
| 21  | Gaming                                |     |                                                      |

Further candidates, not yet researched: Advertising & Marketing agencies, Fashion & Luxury, Mining & Metals,
Chemicals & Materials, Sports & Fitness, Space, Research institutes/think tanks, Social care, Waste & environment,
Security services, Funeral/death care, Pet care. (Advertising, Fashion, Mining and Chemicals are included as
short lists in Appendix A.)

> **Naming note.** The sector you couldn't name is usually called **the Third Sector**, or **Nonprofit / Philanthropy**.
> In the UK "charity sector"; in aid circles "international development" (NGOs) and "grant-making / foundations".
> I split it into three (24, 25, 26) because the employers and job boards differ.

---

# 2. Location lens

Each company has an HQ in brackets, but job pages are per country. Suggested app approach: tag every catalogue
company with `hiringRegions`, and show a sector's list filtered to the person's profile location (the profile already
has location rules). Quick regional shortlists of **big, continuous hirers** per region (cross-sector) follow, chosen
for the Companies page "popular near you" row.

**United Kingdom:** NHS (via NHS Jobs), Civil Service, Tesco, Sainsbury's, Lloyds Banking Group, NatWest, Barclays,
HSBC, Santander UK, BT/EE, Vodafone, BAE Systems, Rolls-Royce, GSK, AstraZeneca, Unilever, Aviva, Legal & General,
PwC, Deloitte, EY, KPMG, Accenture, Capita, Serco, Amazon UK, Compass Group, Sodexo, Network Rail, Transport for London,
Universities (Oxford, UCL, Manchester, Edinburgh, King's), BBC, Shell, BP, National Grid, Octopus Energy, Monzo, Revolut,
Wise.

**United States:** Walmart, Amazon, UnitedHealth, CVS, Kaiser Permanente, HCA, Target, Home Depot, Lowe's, Costco,
JPMorgan, Bank of America, Wells Fargo, Citi, Microsoft, Google, Apple, Meta, Oracle, IBM, Deloitte, Accenture,
Lockheed Martin, RTX, Boeing, Northrop Grumman, General Dynamics, FedEx, UPS, Delta, Johnson & Johnson, Pfizer, USAJobs
(federal), state university systems.

**Nigeria & West Africa:** Dangote Group, MTN Nigeria, Airtel Africa, Access Bank, Zenith Bank, GTBank (GTCO), First
Bank (FBN Holdings), UBA, Stanbic IBTC, NNPC Ltd, Shell/Seplat/TotalEnergies Nigeria, Nestlé Nigeria, Nigerian Breweries,
Flutterwave, Paystack (Stripe), Moniepoint, Interswitch, Andela, PwC/KPMG/EY/Deloitte Nigeria, Procter & Gamble Nigeria,
Unilever Nigeria, Jumia, Konga, TotalEnergies Marketing, Lagos State Government, UN agencies and INGOs (IRC, MSF, Save the
Children, Mercy Corps, FHI 360).

**South & East Africa:** Standard Bank, Absa, FirstRand, Nedbank, Discovery, Sanlam, MTN Group, Vodacom, Safaricom,
Naspers/Prosus, Shoprite, Pick n Pay, Woolworths, Sasol, Anglo American, Transnet, Eskom, KCB, Equity Bank, Ethiopian
Airlines, M-KOPA, Twiga, Cellulant.

**India:** TCS, Infosys, Wipro, HCLTech, Tech Mahindra, Cognizant India, Reliance (Jio/Retail), Tata group, HDFC Bank,
ICICI, SBI, Flipkart, Amazon India, Swiggy, Zomato (Eternal), Paytm, Razorpay, PhonePe, Mahindra, Maruti Suzuki, L&T,
Sun Pharma, Dr Reddy's.

**Gulf (UAE, Saudi, Qatar):** Emirates Group, Etihad, ADNOC, Aramco, Qatar Airways, Emaar, DP World, e&, stc, du, FAB,
Emirates NBD, QNB, PIF companies (NEOM, Red Sea Global, Roshn), Majid Al Futtaim, Noon, Careem, Talabat.

**Continental Europe:** SAP, Siemens, Bosch, VW Group, BMW, Mercedes-Benz, Airbus, Allianz, Deutsche Bank, BNP Paribas,
ING, Nestlé, Novartis, Roche, ASML, Philips, Ericsson, Spotify, Zalando, Adyen, Booking.com, Maersk, Novo Nordisk.

**Asia-Pacific:** Samsung, Toyota, Sony, Hitachi, DBS, Grab, Sea Group, Singtel, Tencent, Alibaba, ByteDance, BHP,
Commonwealth Bank, Telstra, Atlassian, Canva.

**Canada:** RBC, TD, Scotiabank, BMO, CIBC, Shopify, Telus, Bell, Manulife, Sun Life, Loblaw, Magna, CN Rail,
Canadian government.

---

# 3. Most-repeated companies (cross-sector overlap)

Companies that qualify as top hirers in four or more sectors below are good "always offer" suggestions:
- **Amazon:** Software & Cloud, Internet, AI, Retail & E-commerce, Logistics, Media (Prime Video), Healthcare (One Medical).
- **Microsoft:** Software & Cloud, AI, Gaming, Cybersecurity, Government contracting.
- **Google/Alphabet:** Internet, Software & Cloud, AI, Cybersecurity, Healthcare (Verily), Hardware.
- **Apple:** Hardware, Internet, Retail, Media, Fintech (Apple Pay).
- **Amazon, Walmart, Tesco, Costco:** Retail, Logistics, Food, Fintech, Healthcare (pharmacy).
- **Accenture, Deloitte, PwC, EY, KPMG:** Accounting, Consulting, IT Services, Cybersecurity, Government, Legal-adjacent.
- **IBM:** Software, IT Services, Consulting, AI, Cybersecurity.
- **Siemens:** Industrial, Software, Healthcare (Healthineers), Energy, Rail.
- **Honeywell, GE (Aerospace/Vernova/Healthcare), Johnson Controls:** Industrial, Aerospace, Energy, Construction.
- **JPMorgan, Goldman Sachs, Morgan Stanley, Citi, HSBC, BNP Paribas:** Banking, Investment, Fintech, Asset Management.
- **Shell, BP, TotalEnergies:** Oil & Gas, Renewables, Trading, Chemicals.
- **Johnson & Johnson, Roche, Novartis, Siemens Healthineers, GE HealthCare:** Pharma, Medical devices, Biotech.
- **Unilever, P&G, Nestlé, PepsiCo:** FMCG, Food & Beverage, Retail (D2C), Marketing.
- **Marriott, Hilton, Compass Group, Sodexo:** Hospitality, Business Services, Healthcare services, Education.
- **UN agencies (UNICEF, WFP, UNDP, UNHCR, WHO), World Bank:** UN, Development, Government.
- **Save the Children, Oxfam, IRC, Mercy Corps, Plan International, World Vision:** NGOs, Charities, Development.

---

# 4. Top 20 per sector

Format: Company (HQ). A short note follows each list where something affects how Winnow should treat it.

## 1. Software & Cloud

1. Microsoft (US) 2. Oracle (US) 3. SAP (Germany) 4. Salesforce (US) 5. Adobe (US) 6. IBM (US) 7. ServiceNow (US)
2. Workday (US) 9. Intuit (US) 10. Atlassian (Australia) 11. Snowflake (US) 12. Databricks (US) 13. Datadog (US)
3. Shopify (Canada) 15. Autodesk (US) 16. VMware by Broadcom (US) 17. Cisco (US) 18. Palantir (US) 19. Stripe (US/Ireland)
4. Twilio (US)

Note: Oracle and Microsoft have had large 2026 layoffs but remain the heaviest continuous posters. Databricks, Snowflake and Palantir are net growers.

## 2. Internet, Social & Consumer Tech

1. Amazon (US) 2. Alphabet / Google (US) 3. Meta (US) 4. Apple (US) 5. Netflix (US) 6. Uber (US) 7. Airbnb (US)
2. Booking Holdings (US/NL) 9. eBay (US) 10. Spotify (Sweden) 11. Pinterest (US) 12. Snap (US) 13. Reddit (US)
3. DoorDash (US) 15. Instacart/Maplebear (US) 16. TikTok / ByteDance (Singapore/China) 17. Tencent (China)
4. Alibaba (China) 19. Zalando (Germany) 20. Rakuten (Japan)

## 3. AI & Machine Learning

1. OpenAI (US) 2. Anthropic (US) 3. Google DeepMind (UK/US) 4. Meta AI / FAIR (US) 5. Microsoft AI (US/UK)
2. NVIDIA (US) 7. xAI (US) 8. Mistral AI (France) 9. Cohere (Canada) 10. Scale AI (US) 11. Hugging Face (US/France)
3. Perplexity (US) 13. Databricks (US) 14. Safe Superintelligence (US/Israel) 15. Stability AI (UK) 16. ElevenLabs (UK/US)
4. Runway (US) 18. Glean (US) 19. Character.AI (US) 20. Palantir (US)

Note: this is the fastest-hiring group (OpenAI planned ~4,500 to ~8,000 staff in 2026). Most are small enough that a Greenhouse/Ashby feed is cheap to watch, so they work well as a "hot" set. Verify each still exists as an independent employer before shipping; this segment changes quickly.

## 4. Semiconductors & Hardware

1. Apple (US) 2. NVIDIA (US) 3. Intel (US) 4. AMD (US) 5. Qualcomm (US) 6. Broadcom (US) 7. TSMC (Taiwan)
2. Samsung Electronics (S. Korea) 9. ASML (NL) 10. Micron (US) 11. Texas Instruments (US) 12. Applied Materials (US)
3. Lam Research (US) 14. Arm (UK) 15. Dell Technologies (US) 16. HP Inc. (US) 17. HPE (US) 18. Cisco (US)
4. Foxconn / Hon Hai (Taiwan) 20. Sony (Japan)

## 5. IT Services & Outsourcing

1. Accenture (Ireland) 2. TCS (India) 3. Infosys (India) 4. Cognizant (US) 5. Wipro (India) 6. HCLTech (India)
2. IBM Consulting (US) 8. Capgemini (France) 9. Tech Mahindra (India) 10. DXC Technology (US) 11. NTT Data (Japan)
3. Fujitsu (Japan) 13. Atos / Eviden (France) 14. LTIMindtree (India) 15. Genpact (US) 16. EPAM (US)
4. CGI (Canada) 18. Kyndryl (US) 19. Capita (UK) 20. Endava (UK)

## 6. Cybersecurity

1. Microsoft Security (US) 2. Palo Alto Networks (US) 3. CrowdStrike (US) 4. Cisco (US) 5. Fortinet (US)
2. Zscaler (US) 7. Okta (US) 8. Check Point (Israel) 9. Cloudflare (US) 10. SentinelOne (US) 11. Broadcom / Symantec (US)
3. Trend Micro (Japan) 13. Mandiant (Google Cloud) (US) 14. Rapid7 (US) 15. Proofpoint (US) 16. CyberArk (Israel)
4. Darktrace (UK) 18. Wiz (Google) (US/Israel) 19. Booz Allen Hamilton (US) 20. Leidos (US)

## 7. Telecoms

1. AT&T (US) 2. Verizon (US) 3. T-Mobile US (US) 4. Comcast (US) 5. Charter (US) 6. Deutsche Telekom (Germany)
2. Vodafone (UK) 8. BT Group / EE (UK) 9. Orange (France) 10. Telefónica (Spain) 11. Ericsson (Sweden) 12. Nokia (Finland)
3. Huawei (China) 14. MTN Group (S. Africa) 15. Airtel / Bharti (India) 16. Reliance Jio (India) 17. Singtel (Singapore)
4. Telstra (Australia) 19. Rogers (Canada) 20. e& / Etisalat (UAE)

## 8. Retail & Commercial Banking

1. JPMorgan Chase (US) 2. Bank of America (US) 3. Wells Fargo (US) 4. Citigroup (US) 5. HSBC (UK) 6. Barclays (UK)
2. Lloyds Banking Group (UK) 8. NatWest Group (UK) 9. Santander (Spain) 10. BNP Paribas (France) 11. Standard Chartered (UK)
3. Royal Bank of Canada (Canada) 13. TD Bank (Canada) 14. Commonwealth Bank (Australia) 15. ICICI Bank (India)
4. HDFC Bank (India) 17. Standard Bank (S. Africa) 18. Access Bank (Nigeria) 19. Capital One (US) 20. US Bancorp (US)

## 9. Investment Banking & Asset Management

1. Goldman Sachs (US) 2. Morgan Stanley (US) 3. JPMorgan (US) 4. BlackRock (US) 5. Citi (US) 6. UBS (Switzerland)
2. Barclays (UK) 8. Deutsche Bank (Germany) 9. Lazard (US) 10. Rothschild & Co (UK/France) 11. Evercore (US)
3. Jefferies (US) 13. Vanguard (US) 14. Fidelity Investments (US) 15. State Street (US) 16. Schroders (UK)
4. Blackstone (US) 18. KKR (US) 19. Carlyle (US) 20. PIMCO (US)

## 10. Fintech, Payments & Crypto

1. Visa (US) 2. Mastercard (US) 3. PayPal (US) 4. Stripe (US/Ireland) 5. Block / Square (US) 6. Adyen (NL)
2. Revolut (UK) 8. Monzo (UK) 9. Wise (UK) 10. Klarna (Sweden) 11. Chime (US) 12. Robinhood (US)
3. Coinbase (US) 14. Binance (global) 15. Kraken (US) 16. Flutterwave (Nigeria/US) 17. Paystack (Nigeria, Stripe) 18. Moniepoint (Nigeria)
4. Nubank (Brazil) 20. Razorpay (India)

## 11. Insurance

1. AXA (France) 2. Allianz (Germany) 3. Zurich (Switzerland) 4. Aviva (UK) 5. Legal & General (UK) 6. Prudential plc (UK)
2. AIG (US) 8. MetLife (US) 9. Prudential Financial (US) 10. Chubb (Switzerland) 11. Travelers (US) 12. Progressive (US)
3. State Farm (US) 14. Allstate (US) 15. Liberty Mutual (US) 16. Generali (Italy) 17. Munich Re (Germany)
4. Swiss Re (Switzerland) 19. Marsh McLennan (US) 20. Aon (UK/Ireland)

## 12. Accounting, Audit & Tax

1. PwC (UK) 2. Deloitte (UK) 3. EY (UK) 4. KPMG (UK/NL) 5. BDO (Belgium) 6. Grant Thornton (UK/US)
2. RSM (UK/US) 8. Mazars / Forvis Mazars (France) 9. Baker Tilly (UK/US) 10. Crowe (US) 11. Moore Kingston Smith (UK)
3. Azets (UK) 13. Cherry Bekaert (US) 14. CliftonLarsonAllen (US) 15. Moss Adams (US) 16. H&R Block (US)
4. Intuit (US) 18. Xero (NZ) 19. FRC / PCAOB (regulators) 20. ICAEW / ACCA / AICPA (professional bodies)

Note: only the first ~16 are employers in the usual sense; 19-20 are regulators/bodies and could be dropped or moved to Government.

## 13. Management Consulting & Strategy

1. McKinsey (US) 2. Boston Consulting Group (US) 3. Bain (US) 4. Deloitte Consulting (US/UK) 5. Accenture Strategy (Ireland)
2. PwC Strategy& (UK) 7. EY-Parthenon (UK) 8. KPMG Advisory (UK) 9. Oliver Wyman (US) 10. Kearney (US) 11. L.E.K. (UK)
3. Roland Berger (Germany) 13. Capgemini Invent (France) 14. FTI Consulting (US) 15. Alvarez & Marsal (US) 16. Huron (US)
4. West Monroe (US) 18. Slalom (US) 19. Mercer (US) 20. Willis Towers Watson (UK)

## 14. Legal

1. Clifford Chance (UK) 2. Linklaters (UK) 3. Allen & Overy Shearman (UK/US) 4. Freshfields (UK) 5. Slaughter and May (UK)
2. DLA Piper (UK/US) 7. Baker McKenzie (US) 8. Kirkland & Ellis (US) 9. Latham & Watkins (US) 10. Skadden (US)
3. White & Case (US) 12. Norton Rose Fulbright (UK) 13. Herbert Smith Freehills Kramer (UK) 14. Hogan Lovells (UK/US)
4. Ashurst (UK) 16. Addleshaw Goddard (UK) 17. Eversheds Sutherland (UK) 18. Pinsent Masons (UK)
5. Thomson Reuters (Canada, legal-tech) 20. LexisNexis (UK)

Note: many law firms use graduate-scheme portals with annual windows, not rolling feeds.

## 15. Healthcare Providers

1. HCA Healthcare (US) 2. NHS England trusts via NHS Jobs (UK) 3. Kaiser Permanente (US) 4. CommonSpirit Health (US)
2. Ascension (US) 6. Providence (US) 7. Mayo Clinic (US) 8. Cleveland Clinic (US) 9. Mass General Brigham (US)
3. Universal Health Services (US) 11. Community Health Systems (US) 12. Tenet (US) 13. Veterans Health Administration (US)
4. Bupa (UK) 15. Spire Healthcare (UK) 16. Ramsay Health Care (Australia) 17. Fresenius / Helios (Germany)
5. Apollo Hospitals (India) 19. NMC Health / Mediclinic (UAE/S. Africa) 20. DaVita (US)

Note: NHS is hundreds of separate trusts; a single "NHS Jobs" feed is the practical way to cover it.

## 16. Pharmaceuticals

1. Johnson & Johnson (US) 2. Roche (Switzerland) 3. Pfizer (US) 4. Novartis (Switzerland) 5. Merck & Co. (US)
2. AbbVie (US) 7. AstraZeneca (UK) 8. Eli Lilly (US) 9. Novo Nordisk (Denmark) 10. Sanofi (France) 11. GSK (UK)
3. Bristol Myers Squibb (US) 13. Bayer (Germany) 14. Takeda (Japan) 15. Boehringer Ingelheim (Germany) 16. Amgen (US)
4. Gilead (US) 18. Teva (Israel) 19. Sun Pharma (India) 20. Viatris (US)

## 17. Biotech, Life-science Tools & CROs

1. Thermo Fisher (US) 2. IQVIA (US) 3. Danaher (US) 4. Labcorp (US) 5. Syneos Health (US) 6. PPD (Thermo) (US)
2. ICON plc (Ireland) 8. Parexel (US) 9. Charles River Laboratories (US) 10. Medpace (US) 11. Illumina (US)
3. Moderna (US) 13. Regeneron (US) 14. Vertex (US) 15. BioNTech (Germany) 16. Lonza (Switzerland)
4. Agilent (US) 18. WuXi AppTec (China) 19. Catalent / Novo Holdings (US) 20. Genentech (US)

## 18. Medical Devices

1. Medtronic (Ireland) 2. Abbott (US) 3. Siemens Healthineers (Germany) 4. GE HealthCare (US) 5. Philips (NL)
2. Johnson & Johnson MedTech (US) 7. Boston Scientific (US) 8. Stryker (US) 9. Becton Dickinson (US) 10. Baxter (US)
3. Zimmer Biomet (US) 12. Edwards Lifesciences (US) 13. Intuitive Surgical (US) 14. Smith+Nephew (UK) 15. Olympus (Japan)
4. Fresenius Medical Care (Germany) 17. Cardinal Health (US) 18. Dexcom (US) 19. ResMed (US) 20. Hologic (US)

## 19. Health Insurance & Digital Health

1. UnitedHealth Group / Optum (US) 2. CVS Health / Aetna (US) 3. Elevance Health (US) 4. Cigna / Evernorth (US)
2. Humana (US) 6. Centene (US) 7. Kaiser Permanente (US) 8. Bupa (UK) 9. AXA Health (UK) 10. Vitality (UK/S. Africa)
3. Teladoc (US) 12. Oscar Health (US) 13. Epic Systems (US) 14. Oracle Health (Cerner) (US) 15. Babylon successors / Livi (UK/Sweden)
4. Hims & Hers (US) 17. Doximity (US) 18. Zocdoc (US) 19. Ro (US) 20. Huma / Kry (UK/Sweden)

## 20. Media, Publishing & Entertainment

1. Walt Disney (US) 2. Comcast / NBCUniversal (US) 3. Warner Bros. Discovery (US) 4. Netflix (US) 5. Paramount (US)
2. Sony Group (Japan) 7. BBC (UK) 8. ITV (UK) 9. Sky (UK) 10. News Corp (US) 11. Thomson Reuters (Canada)
3. RELX / Elsevier (UK) 13. Pearson (UK) 14. Penguin Random House (US) 15. HarperCollins (US) 16. Universal Music Group (NL/US)
4. Spotify (Sweden) 18. Live Nation (US) 19. Bloomberg (US) 20. Financial Times / Nikkei (UK)

## 21. Gaming

1. Microsoft Gaming / Xbox (US) 2. Sony Interactive (US/Japan) 3. Nintendo (Japan) 4. Tencent Games (China)
2. Electronic Arts (US) 6. Take-Two / Rockstar (US) 7. Ubisoft (France) 8. Activision Blizzard (Microsoft) (US)
3. Epic Games (US) 10. Roblox (US) 11. Riot Games (US) 12. Supercell (Finland) 13. King (Microsoft) (UK/Sweden)
4. Embracer Group (Sweden) 15. CD Projekt (Poland) 16. Bandai Namco (Japan) 17. Square Enix (Japan) 18. Unity (US)
5. Valve (US) 20. Rovio / Playtika / Zynga (various)

Note: the games sector has had repeated layoffs; pages exist but headcount is shrinking.

## 22. Higher Education

Universities post on their own sites or HE-specific boards (jobs.ac.uk, HigherEdJobs).
1. University of Oxford (UK) 2. University of Cambridge (UK) 3. UCL (UK) 4. Imperial College London (UK)
2. King's College London (UK) 6. University of Manchester (UK) 7. University of Edinburgh (UK) 8. Harvard (US)
3. MIT (US) 10. Stanford (US) 11. Johns Hopkins (US) 12. University of California system (US)
4. University of Texas system (US) 14. State University of New York (US) 15. University of Toronto (Canada)
5. University of Melbourne (Australia) 17. National University of Singapore (Singapore) 18. ETH Zurich (Switzerland)
6. Tsinghua / Peking University (China) 20. University of Cape Town / Lagos (Africa)

## 23. EdTech, Training & K-12 Services

1. Pearson (UK) 2. Coursera (US) 3. Duolingo (US) 4. Chegg (US) 5. Instructure (US) 6. 2U (US) 7. Byju's (India, distressed)
2. PhysicsWallah (India) 9. Udemy (US) 10. Khan Academy (US) 11. GoStudent (Austria) 12. Multiverse (UK)
3. BPP / Apollo Education (UK) 14. Kaplan (US) 15. McGraw Hill (US) 16. Cengage (US) 17. Teach First (UK)
4. Teach For America (US) 19. Ark Schools / Harris Federation / Academy trusts (UK) 20. KIPP / Success Academy (US)

## 24. International Development & Humanitarian NGOs

1. BRAC (Bangladesh) 2. International Rescue Committee (US) 3. Save the Children (UK/US) 4. Oxfam (UK)
2. Médecins Sans Frontières / MSF (Switzerland) 6. Mercy Corps (US) 7. World Vision (US) 8. CARE (US/Switzerland)
3. Plan International (UK) 10. Catholic Relief Services (US) 11. Norwegian Refugee Council (Norway) 12. International Committee of the Red Cross (Switzerland)
4. IFRC (Switzerland) 14. ActionAid (UK/SA) 15. Christian Aid (UK) 16. FHI 360 (US) 17. Chemonics (US)
5. DAI Global (US) 19. Palladium (UK) 20. Abt Associates / RTI International (US)

Note: heavy contraction in 2025-26 after US aid cuts; ICRC planning ~2,900 post cuts. Devex's [top employers list](https://www.devex.com/news/the-top-global-development-employers-of-2025-112008) is the right source to re-rank before shipping. Many roles are posted on Devex, ReliefWeb, and the organisations' own sites; watch the own-site feeds.

## 25. Charities, Fundraising & Grant-making (Third Sector)

1. Wellcome Trust (UK) 2. Gates Foundation (US) 3. Ford Foundation (US) 4. Open Society Foundations (US)
2. Rockefeller Foundation (US) 6. Bloomberg Philanthropies (US) 7. Oak Foundation (Switzerland) 8. Novo Nordisk Foundation (Denmark)
3. Cancer Research UK (UK) 10. British Heart Foundation (UK) 11. Macmillan Cancer Support (UK) 12. Age UK (UK)
4. RSPCA / RSPB (UK) 14. National Trust (UK) 15. Barnardo's (UK) 16. Salvation Army (UK/US)
5. American Cancer Society (US) 18. United Way Worldwide (US) 19. Habitat for Humanity (US) 20. YMCA / Scouts / Girlguiding (various)

Note: fundraising roles (fundraiser, donor relations, grants manager) are the key job family. Good additions: Charity Job and Third Sector job boards as sources rather than single employers.

## 26. UN & Multilateral Organisations

1. UNHCR (Switzerland) 2. UNICEF (US) 3. World Food Programme (Italy) 4. UNDP (US) 5. WHO (Switzerland)
2. UN Secretariat (US) 7. World Bank Group (US) 8. IMF (US) 9. IOM (Switzerland) 10. FAO (Italy)
3. UNFPA (US) 12. UN Women (US) 13. UNOPS (Denmark) 14. ILO (Switzerland) 15. UNESCO (France)
4. African Development Bank (Côte d'Ivoire) 17. Asian Development Bank (Philippines) 18. European Commission (Belgium)
5. OECD (France) 20. WTO / WIPO (Switzerland)

Note: UN agencies mostly use Inspira/Taleo-style portals with long closing dates. The UN also has 2026 funding stress (UN Secretariat and OCHA cuts).

## 27. Government & Public Sector

Public sector feeds are per country; these are the big single feeds.
1. UK Civil Service Jobs (UK) 2. NHS Jobs (UK) 3. USAJOBS federal (US) 4. Ministry of Defence (UK) 5. HMRC (UK)
2. Department for Work and Pensions (UK) 7. Home Office (UK) 8. Local councils via Local Government Jobs (UK)
3. Metropolitan Police (UK) 10. Transport for London (UK) 11. State governments (California, Texas, New York) (US)
4. Canada Public Service (Canada) 13. Australian Public Service (Australia) 14. European Commission / EPSO (Belgium)
5. Government of India (UPSC/SSC) (India) 16. Lagos State Government / Federal Civil Service (Nigeria) 17. Singapore Public Service (Singapore)
6. GCHQ / MI5 / MI6 (UK) 19. NASA (US) 20. Federal Reserve / Bank of England (US/UK)

## 28. Defence & Aerospace

1. Lockheed Martin (US) 2. RTX / Raytheon (US) 3. Boeing (US) 4. Northrop Grumman (US) 5. General Dynamics (US)
2. BAE Systems (UK) 7. Airbus (NL/France) 8. L3Harris (US) 9. Rolls-Royce (UK) 10. Leonardo (Italy)
3. Thales (France) 12. Safran (France) 13. GE Aerospace (US) 14. Honeywell Aerospace (US) 15. Babcock International (UK)
4. QinetiQ (UK) 17. Leidos (US) 18. SpaceX (US) 19. Anduril (US) 20. Rheinmetall (Germany)

Note: many roles require security clearance or citizenship; Winnow should surface this requirement. Defence is net-hiring across Europe in 2026.

## 29. Airlines & Aviation

1. Delta (US) 2. American Airlines (US) 3. United Airlines (US) 4. Southwest (US) 5. Emirates Group (UAE)
2. Qatar Airways (Qatar) 7. Lufthansa Group (Germany) 8. Air France-KLM (France/NL) 9. IAG: British Airways / Iberia (UK/Spain)
3. Ryanair (Ireland) 11. easyJet (UK) 12. Turkish Airlines (Turkey) 13. Singapore Airlines (Singapore) 14. Etihad (UAE)
4. Ethiopian Airlines (Ethiopia) 16. Air Canada (Canada) 17. Qantas (Australia) 18. IndiGo (India) 19. Heathrow Airport (UK)
5. FedEx / UPS Airlines (US)

## 30. Automotive & EV

1. Toyota (Japan) 2. Volkswagen Group (Germany) 3. Stellantis (NL) 4. Ford (US) 5. General Motors (US)
2. Hyundai / Kia (S. Korea) 7. Mercedes-Benz (Germany) 8. BMW (Germany) 9. Honda (Japan) 10. Tesla (US)
3. BYD (China) 12. Nissan (Japan) 13. Tata Motors / JLR (India/UK) 14. Renault (France) 15. Rivian (US)
4. Bosch (Germany) 17. Continental (Germany) 18. Magna (Canada) 19. Denso (Japan) 20. Mahindra (India)

## 31. Oil, Gas & Energy Majors

1. ExxonMobil (US) 2. Shell (UK) 3. Chevron (US) 4. BP (UK) 5. TotalEnergies (France)
2. Saudi Aramco (Saudi Arabia) 7. ADNOC (UAE) 8. ConocoPhillips (US) 9. Eni (Italy) 10. Equinor (Norway)
3. Schlumberger / SLB (US) 12. Halliburton (US) 13. Baker Hughes (US) 14. Petrobras (Brazil) 15. NNPC Ltd (Nigeria)
4. Sinopec / CNPC (China) 17. Occidental (US) 18. Phillips 66 (US) 19. Seplat (Nigeria) 20. Woodside (Australia)

## 32. Renewables, Utilities & Climate

1. NextEra Energy (US) 2. Ørsted (Denmark) 3. Iberdrola (Spain) 4. Enel (Italy) 5. EDF (France)
2. National Grid (UK) 7. SSE (UK) 8. Octopus Energy (UK) 9. Vestas (Denmark) 10. Siemens Gamesa (Spain)
3. First Solar (US) 12. GE Vernova (US) 13. RWE (Germany) 14. Duke Energy (US) 15. Southern Company (US)
4. Centrica / British Gas (UK) 17. ScottishPower (UK) 18. Adani Green / Tata Power (India) 19. Brookfield Renewable (Canada)
5. Schneider Electric (France)

## 33. Industrial Manufacturing

1. Siemens (Germany) 2. General Electric (US) 3. Honeywell (US) 4. 3M (US) 5. ABB (Switzerland)
2. Caterpillar (US) 7. Deere (US) 8. Emerson (US) 9. Schneider Electric (France) 10. Eaton (Ireland)
3. Johnson Controls (Ireland) 12. Hitachi (Japan) 13. Mitsubishi Heavy Industries (Japan) 14. Rockwell Automation (US)
4. Parker Hannifin (US) 16. Danaher (US) 17. Cummins (US) 18. Tata Steel / Tata Group (India) 19. Dyson (UK/Singapore)
5. Whirlpool (US)

## 34. Construction, Engineering & Infrastructure

1. Bechtel (US) 2. Vinci (France) 3. ACS / Hochtief (Spain/Germany) 4. Skanska (Sweden) 5. Balfour Beatty (UK)
2. Kier (UK) 7. Laing O'Rourke (UK) 8. AECOM (US) 9. Jacobs (US) 10. Fluor (US)
3. Arup (UK) 12. Atkins Réalis (Canada/UK) 13. WSP (Canada) 14. Mott MacDonald (UK) 15. Stantec (Canada)
4. Larsen & Toubro (India) 17. Turner Construction (US) 18. Network Rail (UK) 19. HS2 Ltd (UK) 20. China State Construction (China)

## 35. Real Estate & PropTech

1. CBRE (US) 2. JLL (US) 3. Cushman & Wakefield (US) 4. Savills (UK) 5. Knight Frank (UK)
2. Colliers (Canada) 7. Zillow (US) 8. Compass (US) 9. Rightmove (UK) 10. Zoopla (UK)
3. Barratt Redrow (UK) 12. Persimmon (UK) 13. Taylor Wimpey (UK) 14. Lennar (US) 15. D.R. Horton (US)
4. Prologis (US) 17. Emaar (UAE) 18. Land Securities (UK) 19. British Land (UK) 20. WeWork / IWG (US/Switzerland)

## 36. Retail & E-commerce

1. Walmart (US) 2. Amazon (US) 3. Costco (US) 4. Tesco (UK) 5. Target (US)
2. Home Depot (US) 7. Lowe's (US) 8. Kroger (US) 9. Schwarz Group (Lidl/Kaufland) (Germany) 10. Aldi (Germany)
3. Carrefour (France) 12. Sainsbury's (UK) 13. Marks & Spencer (UK) 14. IKEA / Ingka (Sweden/NL) 15. Ahold Delhaize (NL)
4. Alibaba (China) 17. JD.com (China) 18. Shopify (Canada) 19. Zalando (Germany) 20. Jumia (Nigeria/Germany)

## 37. Consumer Goods (FMCG)

1. Unilever (UK) 2. Procter & Gamble (US) 3. Nestlé (Switzerland) 4. PepsiCo (US) 5. Coca-Cola (US)
2. L'Oréal (France) 7. Mondelez (US) 8. Reckitt (UK) 9. Colgate-Palmolive (US) 10. Kimberly-Clark (US)
3. Danone (France) 12. Diageo (UK) 13. Haleon (UK) 14. Kraft Heinz (US) 15. Mars (US)
4. Estée Lauder (US) 17. Henkel (Germany) 18. Beiersdorf (Germany) 19. Johnson & Johnson Consumer / Kenvue (US) 20. Dangote Group (Nigeria)

## 38. Food, Beverage & Agriculture

1. Nestlé (Switzerland) 2. PepsiCo (US) 3. Coca-Cola (US) 4. Tyson Foods (US) 5. JBS (Brazil)
2. Cargill (US) 7. ADM (US) 8. Bunge (US) 9. Danone (France) 10. Kraft Heinz (US)
3. General Mills (US) 12. Kellogg's / Kellanova (US) 13. Heineken (NL) 14. AB InBev (Belgium) 15. Diageo (UK)
4. Bayer Crop Science (Germany) 17. Syngenta (Switzerland) 18. Corteva (US) 19. Olam / Wilmar (Singapore) 20. Dangote / Olam Nigeria (Nigeria)

## 39. Hospitality, Travel & Leisure

1. Marriott (US) 2. Hilton (US) 3. IHG (UK) 4. Accor (France) 5. Hyatt (US)
2. Wyndham (US) 7. McDonald's (US) 8. Starbucks (US) 9. Yum! Brands (US) 10. Compass Group (UK)
3. TUI (Germany) 12. Carnival (US) 13. Royal Caribbean (US) 14. Expedia (US) 15. Booking Holdings (US/NL)
4. Airbnb (US) 17. Whitbread / Premier Inn (UK) 18. Merlin Entertainments (UK) 19. Disney Parks (US) 20. Las Vegas Sands / MGM (US)

## 40. Logistics, Shipping & Supply Chain

1. Amazon Logistics (US) 2. DHL Group (Germany) 3. UPS (US) 4. FedEx (US) 5. Maersk (Denmark)
2. DSV (Denmark) 7. Kuehne+Nagel (Switzerland) 8. XPO (US) 9. GXO (US) 10. CMA CGM (France)
3. MSC (Switzerland) 12. Royal Mail / International Distribution Services (UK) 13. Evri (UK) 14. DP World (UAE)
4. J.B. Hunt (US) 16. C.H. Robinson (US) 17. Expeditors (US) 18. Ocado (UK) 19. Flexport (US) 20. Cainiao / Alibaba (China)

## 41. Business Services, Facilities & Outsourcing

1. Compass Group (UK) 2. Sodexo (France) 3. Aramark (US) 4. ISS (Denmark) 5. Serco (UK)
2. Capita (UK) 7. G4S / Allied Universal (US) 8. Securitas (Sweden) 9. Mitie (UK) 10. Sodexo Government (France)
3. Teleperformance (France) 12. Concentrix (US) 13. TaskUs (US) 14. Genpact (US) 15. Experian (Ireland)
4. Equifax (US) 17. Gartner (US) 18. Cintas (US) 19. ADP (US) 20. Paychex (US)

---

# Appendix A — Short lists for sectors not yet at 20

These are real hirers but each list needs one more research round to reach 20 with confidence.
- **Advertising & Marketing:** WPP, Publicis, Omnicom Interpublic, Dentsu, Havas, S4 Capital, Ogilvy, Wunderman Thompson,
  Accenture Song, HubSpot, Mailchimp (Intuit), Meta Ads, Google Ads, Adobe, Salesforce Marketing Cloud, Nielsen, Kantar,
  Ipsos.
- **Fashion & Luxury:** LVMH, Kering, Hermès, Richemont, Inditex, H&M, Nike, Adidas, Burberry, Primark / ABF, Zara,
  Shein, Ralph Lauren, Estée Lauder, L'Oréal Luxe, Puma, Lululemon, ASOS, Boohoo, Next.
- **Mining & Metals:** BHP, Rio Tinto, Anglo American, Glencore, Vale, Freeport-McMoRan, Newmont, Barrick, Fortescue,
  ArcelorMittal, Tata Steel, Nucor, Teck, Antofagasta, South32, AngloGold Ashanti, Sibanye-Stillwater, Zijin Mining.
- **Chemicals & Materials:** BASF, Dow, DuPont, Linde, LyondellBasell, SABIC, Air Liquide, Evonik, Covestro, AkzoNobel,
  Sherwin-Williams, PPG, Johnson Matthey, Croda, Corning, Saint-Gobain, Holcim, CRH, Heidelberg Materials, Lafarge.

---

# Next steps (proposed, not started)

1. **Pick the count and ship order.** The 41 lists above come to ~820 entries with ~600 unique companies after overlap.
   Recommend shipping in waves, starting with sectors people most often seed Winnow with (Software, AI, Finance,
   Consulting, Health, NGOs).
2. **Resolve each company's real careers feed.** Winnow's `scan/feeds.ts` already learns feeds from jobs seen, with
   job-system directories (`find-portal.ts`). Run that over the catalogue offline, keep only those that resolve to a
   monitorable feed, and record the provider (Greenhouse, Lever, Workday, etc.). Expect roughly 60–70% to resolve; the
   rest (own-site-only, graduate portals, government) need a per-company note or are dropped.
3. **Verify shifting segments** immediately before launch: AI labs, fintech/crypto, edtech and NGOs change fastest
   (acquisitions, shutdowns, aid cuts).
4. **Data shape.** A single `catalogue` file of `{ name, sectors[], hq, hiringRegions[], careersUrl, provider,
   isAgency:false }`, owned by the server like the feed store, so "seen your sector" prompts can read it without
   per-person data. Contract goes in `packages/api/src/index.ts` first, per the repo rules.
5. **Sector detection.** Needs a mapping from a person's scored jobs/companies to these sectors. Cheapest start:
   tag catalogue companies, infer sector from the companies already in the person's inbox/shortlist, then offer the
   top few not yet tracked.
6. **Stronger evidence if wanted:** pull Devex (NGOs), jobs.ac.uk (HE), NHS England workforce statistics, USAJOBS,
   Becker's (US hospitals) and Fortune/Forbes lists per sector to re-rank, and use a job-count from each careers feed as the
   true "hiring volume" measure instead of editorial judgement.
