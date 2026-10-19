begin;
delete from public.texas_resources where slug in ('ok-oas-survey','ok-anthro-soc','nm-hpd','nm-asnm','la-doa','la-las','ar-survey','ar-society','ks-khs','ks-kaa','mo-shpo','mo-mas','az-asm','az-shpo','az-aas','ca-ohp','ca-sca','ca-scps','id-shpo','id-ias','fl-bar','fl-fas','fl-fps','ny-nysm','ny-nysaa','pa-shpo','pa-spa','pa-dvps','il-isas','il-shpo','oh-ohc','oh-aso','ga-hpd','ga-sga','nc-osa','nc-ncas','nc-ncfc','mi-shpo','mi-mas','mi-fummp','ms-mdah','ms-maa','afms-cfms','afms-efmls','afms-mwf','afms-nfms','afms-rmfms','afms-scfms','afms-sfms','saa','aia-find','svp-ask','ps-ask','nasa-arch','afms','ppn-archsoc');
alter table public.texas_resources drop column if exists covers, drop column if exists state;
commit;
