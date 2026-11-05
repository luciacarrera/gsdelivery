// Data for the Sankey printed on the box, from cardboard_box_buyers_sankey_v10.html (issue #29).

// id, label, SimaPro process name, amount, SimaPro cumulative value (×1e-6), category
export type ProcessRow = [id: string, name: string, orig: string, amt: string, full: number, cat: string]
export const PROCESSES: ProcessRow[] = [
  ["box","Corrugated box","Corrugated board box {US}","1 kg",51.4,"box"],
  ["cbm","Containerboard, delivered","Containerboard, market {US}","1.1 kg",42.5,"board"],
  ["cbp","Containerboard mill","Containerboard production {US}","1.1 kg",40.0,"board"],
  ["msm","Starch glue","Maize starch, market {GLO}","0.0229 kg",1.19,"maize"],
  ["msp","Starch production","Maize starch production {RoW}","0.0228 kg",1.10,"maize"],
  ["trm","Rail transport","Train freight, market {US}","0.486 tkm",1.28,"trans"],
  ["trp","Freight trains","Train freight, fleet avg {US}","0.486 tkm",1.28,"trans"],
  ["ngm","Natural gas","Natural gas, market {US}","0.196 m³",2.94,"gas"],
  ["pw","Pulpwood","Pulpwood, softwood {US}","0.00126 m³",1.14,"board"],
  ["lor","Truck transport","Lorry freight, market","0.586 tkm",3.87,"trans"],
  ["wpg","Waste paperboard","Waste paperboard, sorted {GLO}","0.544 kg",1.57,"waste"],
  ["wpc","Waste paperboard (China)","Waste paperboard, sorted {CH}","0.539 kg",1.54,"waste"],
  ["el","Electricity","Electricity, MV {US}","2.26 MJ",11.7,"elec"],
  ["ht","Industrial heat","Heat, industrial, market","0.859 MJ",3.82,"heat"],
  ["msw","Waste disposal","Municipal solid waste {RoW}","0.0512 kg",1.67,"waste"],
  ["slu","Mill sludge disposal","Sludge from pulp & paper","0.0308 kg",0.97,"waste"],
  ["coal","Coal briquettes","Hard coal briquettes","1.19 MJ",0.62,"gas"],
  ["lime","Quicklime","Quicklime, milled {RoW}","0.00909 kg",0.48,"chem"],
  ["chip","Wood chips","Wood chips, green, softwood","0.314 kg",0.43,"board"],
  ["inf","Mill equipment & buildings","Paper mill, integrated (infrastructure)","5.9E-11 p",0.51,"chem"],
];

// parent, child, value (×1e-6). Shared processes are split between parents in proportion to
// SimaPro's line widths in the 1% network; shares that reach a process through other processes
// already counted (e.g. natural gas inside electricity) are not repeated.
export const PROCESS_LINKS: [source: string, target: string, value: number][] = [
  ["box","cbm",42.5], ["box","el",2.68], ["box","msm",1.07], ["box","ngm",0.19],
  ["cbm","cbp",40.0], ["cbm","lor",1.50], ["cbm","trm",1.00],
  ["trm","trp",1.00], ["msm","msp",1.10],
  // containerboard mill inputs: from the containerboard network (1 kg, 1% cut-off), scaled ×1.102 to the box's 1.1 kg
  ["cbp","el",8.65], ["cbp","ht",3.50], ["cbp","ngm",1.65], ["cbp","wpg",1.56], ["cbp","msw",1.54], ["cbp","lor",1.54],
  ["cbp","pw",1.15], ["cbp","slu",0.97], ["cbp","coal",0.62], ["cbp","inf",0.51], ["cbp","lime",0.48], ["cbp","chip",0.43],
  ["cbp","msm",0.12],
  ["wpg","wpc",1.54],
];

// Box demand chain, North America 2025 (million tonnes): node labels and category, then the
// links as parallel arrays (source, target, value, colour)
export const CHAIN: {
  labels: string[]
  cat: number[]
  src: number[]
  tgt: number[]
  val: number[]
  lc: number[]
} = {"labels":["All corrugated box demand","Food & Beverages","E-Commerce","Transport & Logistics","Electronics & Electricals","Others","PepsiCo 4.5%","Tyson Foods 4.1%","Nestlé (US & Canada) 3.1%","JBS USA 2.5%","Kraft Heinz 1.6%","General Mills 1.4%","Coca-Cola 1.4%","Anheuser-Busch InBev 1.2%","Cargill 1.2%","Mars 1.2%","Top 10-50 companies 22.1%","Other F&B 55.6%","Amazon 40.5%","Walmart 9.2%","Apple 3.2%","Other e-commerce 47.1%","Amazon (parcel) 31.5%","USPS 31.0%","UPS 20.7%","FedEx 16.9%","HP 24.4%","Dell 22.5%","Lenovo 18.1%","Apple (PCs) 17.9%","Acer 4.6%","Other electronics 12.5%","","","","",""],"cat":[-1,0,1,2,3,4,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,3,3,4,-1,5,6,7],"src":[0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,4,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,33,33],"tgt":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,33,33,33,33,33,33,33,33,33,33,33,33,33,33,33,33,33,33,33,33,33,33,33,33,33,33,34,35,36],"val":[19.29,13.77,9.29,5.63,7.95,0.871,0.788,0.604,0.485,0.315,0.268,0.262,0.236,0.235,0.235,4.272,10.719,5.577,1.267,0.441,6.486,2.922,2.879,1.919,1.57,1.374,1.267,1.019,1.008,0.259,0.704,7.95,0.871,0.788,0.604,0.485,0.315,0.268,0.262,0.236,0.235,0.235,4.272,10.719,5.577,1.267,0.441,6.486,2.922,2.879,1.919,1.57,1.374,1.267,1.019,1.008,0.259,0.704,7.95,53.9744,1.5661,0.3915],"lc":[0,1,2,3,4,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,3,3,4,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,3,3,4,5,6,7]}
