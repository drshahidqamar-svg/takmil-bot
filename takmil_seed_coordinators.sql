-- TAKMIL Coordinator & School Import
-- Run this in Railway PostgreSQL console


CREATE TABLE IF NOT EXISTS regional_coordinators (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  region TEXT NOT NULL,
  phone TEXT DEFAULT '',
  password TEXT DEFAULT 'takmil123',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS school_coordinators (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  regional_coordinator_id INTEGER REFERENCES regional_coordinators(id),
  phone TEXT DEFAULT '',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assessment_pins (
  id SERIAL PRIMARY KEY,
  pin TEXT NOT NULL UNIQUE,
  school_identifier TEXT NOT NULL,
  level INTEGER NOT NULL,
  scheduled_date DATE NOT NULL,
  created_by_id INTEGER REFERENCES regional_coordinators(id),
  school_coordinator_id INTEGER REFERENCES school_coordinators(id),
  teacher_phone TEXT DEFAULT '',
  activated_at TIMESTAMP,
  expires_at TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Regional Coordinators
INSERT INTO regional_coordinators (id, name, region) VALUES (1, 'M. Ali', 'Sindh') ON CONFLICT DO NOTHING;
INSERT INTO regional_coordinators (id, name, region) VALUES (2, 'M. Ali', 'Punjab') ON CONFLICT DO NOTHING;
INSERT INTO regional_coordinators (id, name, region) VALUES (3, 'M. Ayub', 'Punjab') ON CONFLICT DO NOTHING;
INSERT INTO regional_coordinators (id, name, region) VALUES (4, 'Qiyanoos Khan', 'KPK') ON CONFLICT DO NOTHING;
INSERT INTO regional_coordinators (id, name, region) VALUES (5, 'Qiyanoos Khan', 'GB') ON CONFLICT DO NOTHING;
INSERT INTO regional_coordinators (id, name, region) VALUES (6, 'Shabir khan', 'GB') ON CONFLICT DO NOTHING;
INSERT INTO regional_coordinators (id, name, region) VALUES (7, 'Shabir khan', 'Baluchistan') ON CONFLICT DO NOTHING;

-- School Coordinators
INSERT INTO school_coordinators (id, name, regional_coordinator_id) VALUES (1, 'Fateh Khan', 1) ON CONFLICT DO NOTHING;
INSERT INTO school_coordinators (id, name, regional_coordinator_id) VALUES (2, 'Ghulam Mujtaba', 1) ON CONFLICT DO NOTHING;
INSERT INTO school_coordinators (id, name, regional_coordinator_id) VALUES (3, 'Inayat Lashari', 1) ON CONFLICT DO NOTHING;
INSERT INTO school_coordinators (id, name, regional_coordinator_id) VALUES (4, 'Arqam Aftab', 1) ON CONFLICT DO NOTHING;
INSERT INTO school_coordinators (id, name, regional_coordinator_id) VALUES (5, 'Mehrun Nisa', 1) ON CONFLICT DO NOTHING;
INSERT INTO school_coordinators (id, name, regional_coordinator_id) VALUES (6, 'Farhan Haider', 3) ON CONFLICT DO NOTHING;
INSERT INTO school_coordinators (id, name, regional_coordinator_id) VALUES (7, 'Muhammad Ishaq', 3) ON CONFLICT DO NOTHING;
INSERT INTO school_coordinators (id, name, regional_coordinator_id) VALUES (8, 'Raheel Maqbool', 3) ON CONFLICT DO NOTHING;
INSERT INTO school_coordinators (id, name, regional_coordinator_id) VALUES (9, 'Saima Majeed', 3) ON CONFLICT DO NOTHING;
INSERT INTO school_coordinators (id, name, regional_coordinator_id) VALUES (10, 'Abid Afridi', 4) ON CONFLICT DO NOTHING;
INSERT INTO school_coordinators (id, name, regional_coordinator_id) VALUES (11, 'Ishaq Khan', 4) ON CONFLICT DO NOTHING;
INSERT INTO school_coordinators (id, name, regional_coordinator_id) VALUES (12, 'Saddam Hussain', 4) ON CONFLICT DO NOTHING;
INSERT INTO school_coordinators (id, name, regional_coordinator_id) VALUES (13, 'Sundus Jahanzeb', 4) ON CONFLICT DO NOTHING;
INSERT INTO school_coordinators (id, name, regional_coordinator_id) VALUES (14, 'Ghulam Sarwar', 6) ON CONFLICT DO NOTHING;
INSERT INTO school_coordinators (id, name, regional_coordinator_id) VALUES (15, 'M. Younas', 6) ON CONFLICT DO NOTHING;
INSERT INTO school_coordinators (id, name, regional_coordinator_id) VALUES (16, 'Saddam Wali', 6) ON CONFLICT DO NOTHING;
INSERT INTO school_coordinators (id, name, regional_coordinator_id) VALUES (17, 'Saqiba Baloch', 6) ON CONFLICT DO NOTHING;
INSERT INTO school_coordinators (id, name, regional_coordinator_id) VALUES (18, 'Suman Nazir', 6) ON CONFLICT DO NOTHING;

-- Update schools table with identifier and coordinator info
ALTER TABLE schools ADD COLUMN IF NOT EXISTS identifier TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS region TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS regional_coordinator_id INTEGER;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS school_coordinator_id INTEGER;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS teacher_phone TEXT DEFAULT '';

INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('AliHassanHingrjo_O_W24S', 'AliHassanHingrjo_O_W24S', 'Sindh', 1, 1, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('HajiPirBakshRajhir_A_W24S', 'HajiPirBakshRajhir_A_W24S', 'Sindh', 1, 1, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('MohammedAbbasSolangi_A_W24S', 'MohammedAbbasSolangi_A_W24S', 'Sindh', 1, 1, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('MubeenFaqirRajar_A_W24S', 'MubeenFaqirRajar_A_W24S', 'Sindh', 1, 1, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('MubeenFaqirRajar_B_W24S', 'MubeenFaqirRajar_B_W24S', 'Sindh', 1, 1, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('AliHassanKK_A_W24S', 'AliHassanKK_A_W24S', 'Sindh', 1, 1, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('DodobirHamani_O_W26S', 'DodobirHamani_O_W26S', 'Sindh', 1, 1, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('AliHassanKK_B_W24S', 'AliHassanKK_B_W24S', 'Sindh', 1, 1, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('AbdulKarimKhashkeli_O_F23S', 'AbdulKarimKhashkeli_O_F23S', 'Sindh', 1, 2, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('AbdulKarimKhashkheli_O_W25S', 'AbdulKarimKhashkheli_O_W25S', 'Sindh', 1, 2, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('AbdulRehmanMallah_O_SP23S', 'AbdulRehmanMallah_O_SP23S', 'Sindh', 1, 2, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('BaghatMehraj_O_W24S', 'BaghatMehraj_O_W24S', 'Sindh', 1, 2, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('HayatShah_O_W25S', 'HayatShah_O_W25S', 'Sindh', 1, 2, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('QaziRasoolBux_O_W24S', 'QaziRasoolBux_O_W24S', 'Sindh', 1, 2, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('HayatShah_O_W24S', 'HayatShah_O_W24S', 'Sindh', 1, 2, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('AllahWarayoShoro_O_W26S', 'AllahWarayoShoro_O_W26S', 'Sindh', 1, 3, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('BubuChana_O_W26S', 'BubuChana_O_W26S', 'Sindh', 1, 3, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('CrashMountainArea_A_W26S', 'CrashMountainArea_A_W26S', 'Sindh', 1, 3, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('CrashMountainArea_B_W26S', 'CrashMountainArea_B_W26S', 'Sindh', 1, 3, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('GhulamMuhammadLashari_A_W26S', 'GhulamMuhammadLashari_A_W26S', 'Sindh', 1, 3, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('GhulamMuhammadLashari_B_W26S', 'GhulamMuhammadLashari_B_W26S', 'Sindh', 1, 3, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('HiduMohallah_O_W26S', 'HiduMohallah_O_W26S', 'Sindh', 1, 3, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('MiranKhanSolangi_O_W26S', 'MiranKhanSolangi_O_W26S', 'Sindh', 1, 3, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('MirpurKhas_O_W26S', 'MirpurKhas_O_W26S', 'Sindh', 1, 3, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Bhujbar_O_W26S', 'Bhujbar_O_W26S', 'Sindh', 1, 3, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('KhutriBangla_O_W26P', 'KhutriBangla_O_W26P', 'Punjab', 1, 4, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('HayatLar_O_W26P', 'HayatLar_O_W26P', 'Punjab', 1, 4, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('JhokAbdulSuleman_O_W26P', 'JhokAbdulSuleman_O_W26P', 'Punjab', 1, 4, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('LohiBhir_O_W26P', 'LohiBhir_O_W26P', 'Punjab', 1, 4, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('AwaisNagar_O_W26P', 'AwaisNagar_O_W26P', 'Punjab', 1, 4, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('BastiSadiqabad_O_W26P', 'BastiSadiqabad_O_W26P', 'Punjab', 1, 4, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Hafizabad_O_W26P', 'Hafizabad_O_W26P', 'Punjab', 1, 4, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Murghai_O_W26P', 'Murghai_O_W26P', 'Punjab', 1, 4, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('RoshanBhait_O_W26P', 'RoshanBhait_O_W26P', 'Punjab', 1, 4, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('MuhammadAbadColonyAhmadpur_O_W26P', 'MuhammadAbadColonyAhmadpur_O_W26P', 'Punjab', 1, 4, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('BastiBandAli_O_W26P', 'BastiBandAli_O_W26P', 'Punjab', 1, 5, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('BastiWaryamLarr_O_W26P', 'BastiWaryamLarr_O_W26P', 'Punjab', 1, 5, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('KotliBalouch_O_W26P', 'KotliBalouch_O_W26P', 'Punjab', 1, 5, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Soivehar_O_W26P', 'Soivehar_O_W26P', 'Punjab', 1, 5, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Toheedabad_O_W26P', 'Toheedabad_O_W26P', 'Punjab', 1, 5, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Fatimacolony_O_W26P', 'Fatimacolony_O_W26P', 'Punjab', 1, 5, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('MeharShah_O_W26P', 'MeharShah_O_W26P', 'Punjab', 1, 5, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Ramli_O_W26P', 'Ramli_O_W26P', 'Punjab', 1, 5, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('HariSingh_O_W26P', 'HariSingh_O_W26P', 'Punjab', 1, 5, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('IsraniStationNorth_O_W26P', 'IsraniStationNorth_O_W26P', 'Punjab', 1, 5, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('BastiGohtShahMuhammad_O_W24P', 'BastiGohtShahMuhammad_O_W24P', 'Punjab', 3, 6, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('TibiHootMahar_A_W24P', 'TibiHootMahar_A_W24P', 'Punjab', 3, 6, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('BastiMahchi_O_W24P', 'BastiMahchi_O_W24P', 'Punjab', 3, 6, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('MoreKhunda_O_W24P', 'MoreKhunda_O_W24P', 'Punjab', 3, 6, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('AwaisNagar_O_W25P', 'AwaisNagar_O_W25P', 'Punjab', 3, 6, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('KachaKakar_O_W25P', 'KachaKakar_O_W25P', 'Punjab', 3, 6, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('KhokranWala_O_W24P', 'KhokranWala_O_W24P', 'Punjab', 3, 6, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('BastiRafiqabad_O_W24P', 'BastiRafiqabad_O_W24P', 'Punjab', 3, 7, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Chak#112DNB_O_W24P', 'Chak#112DNB_O_W24P', 'Punjab', 3, 7, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Chak#71DB_A_W24P', 'Chak#71DB_A_W24P', 'Punjab', 3, 7, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Chak#71DB_B_W24P', 'Chak#71DB_B_W24P', 'Punjab', 3, 7, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Chak#91DNB_O_W24P', 'Chak#91DNB_O_W24P', 'Punjab', 3, 7, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('JamalChannar_O_W24P', 'JamalChannar_O_W24P', 'Punjab', 3, 7, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('LundaPhatak_O_W24P', 'LundaPhatak_O_W24P', 'Punjab', 3, 7, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Lunda Phatak_O_W25P', 'Lunda Phatak_O_W25P', 'Punjab', 3, 7, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('MahanjiWala_O_W24P', 'MahanjiWala_O_W24P', 'Punjab', 3, 7, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('MuhammadiColony_O_W24F', 'MuhammadiColony_O_W24F', 'Punjab', 3, 7, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Chak#93DB_O_W24P', 'Chak#93DB_O_W24P', 'Punjab', 3, 7, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Khanewal_O_W23P', 'Khanewal_O_W23P', 'Punjab', 3, 7, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('ToheedAbad_O_W25P', 'ToheedAbad_O_W25P', 'Punjab', 3, 8, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('BastiSheikhShujra_O_W24P', 'BastiSheikhShujra_O_W24P', 'Punjab', 3, 8, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('BastiShahWali_O_W24P', 'BastiShahWali_O_W24P', 'Punjab', 3, 8, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('BastiMatla_O_W24P', 'BastiMatla_O_W24P', 'Punjab', 3, 8, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('BastiTaheemAbad_O_W24P', 'BastiTaheemAbad_O_W24P', 'Punjab', 3, 8, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('BastiKhaninArain_O_W24P', 'BastiKhaninArain_O_W24P', 'Punjab', 3, 8, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('BastiKaramShah_B_W24P', 'BastiKaramShah_B_W24P', 'Punjab', 3, 8, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('BastiBhutta_O_W24P', 'BastiBhutta_O_W24P', 'Punjab', 3, 8, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('BastiDuniapur_O_W24P', 'BastiDuniapur_O_W24P', 'Punjab', 3, 8, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('BastiBhuttaLashari_O_W24P', 'BastiBhuttaLashari_O_W24P', 'Punjab', 3, 8, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('BastiHabibabad_O_W24P', 'BastiHabibabad_O_W24P', 'Punjab', 3, 8, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('IsraniStation_O_W24P', 'IsraniStation_O_W24P', 'Punjab', 3, 9, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('ModelTownManawala_A_W24P', 'ModelTownManawala_A_W24P', 'Punjab', 3, 9, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('ModelTownManawala_B_W24P', 'ModelTownManawala_B_W24P', 'Punjab', 3, 9, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('BastiAllahBaksh_A_W24P', 'BastiAllahBaksh_A_W24P', 'Punjab', 3, 9, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('BastiAllahBaksh_B_W24P', 'BastiAllahBaksh_B_W24P', 'Punjab', 3, 9, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('BastiToutiMachi_A_W24P', 'BastiToutiMachi_A_W24P', 'Punjab', 3, 9, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Khanewal_O_W24P', 'Khanewal_O_W24P', 'Punjab', 3, 9, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('KandayWalaBastiMetla_O_W24P', 'KandayWalaBastiMetla_O_W24P', 'Punjab', 3, 9, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('BastiKamalShah_O_W24P', 'BastiKamalShah_O_W24P', 'Punjab', 3, 9, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Soonkhura_O_W24P', 'Soonkhura_O_W24P', 'Punjab', 3, 9, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('BastiNoorMuhammadMusani_O_SP23P', 'BastiNoorMuhammadMusani_O_SP23P', 'Punjab', 3, 9, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Basti Daim_O_W25P', 'Basti Daim_O_W25P', 'Punjab', 3, 9, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('KamarKhelBazgara_O_W24KPK', 'KamarKhelBazgara_O_W24KPK', 'KPK', 4, 10, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('KhanBaiKhelomela_A_W24KPK', 'KhanBaiKhelomela_A_W24KPK', 'KPK', 4, 10, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('KhanBaiKhelomela_B_W24KPK', 'KhanBaiKhelomela_B_W24KPK', 'KPK', 4, 10, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('MuhammadJannahKallyKhawarKhasrogi_A_W24KPK', 'MuhammadJannahKallyKhawarKhasrogi_A_W24KPK', 'KPK', 4, 10, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('MuhammadJannahKallyKhawarKhasrogi_B_W24KPK', 'MuhammadJannahKallyKhawarKhasrogi_B_W24KPK', 'KPK', 4, 10, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Zagadherai_O_W24KPK', 'Zagadherai_O_W24KPK', 'KPK', 4, 10, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Faizabad_O_W26KPK', 'Faizabad_O_W26KPK', 'KPK', 4, 10, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Gawaki_O_W26KPK', 'Gawaki_O_W26KPK', 'KPK', 4, 10, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Babro_A_W24KPK', 'Babro_A_W24KPK', 'KPK', 4, 10, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Babro_D_W24KPK', 'Babro_D_W24KPK', 'KPK', 4, 10, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Jabori_O_W26KPK', 'Jabori_O_W26KPK', 'KPK', 4, 10, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Khyber_O_W26KPK', 'Khyber_O_W26KPK', 'KPK', 4, 10, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Darel_A_W23GB', 'Darel_A_W23GB', 'GB', 4, 11, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Darel_B_W23GB', 'Darel_B_W23GB', 'GB', 4, 11, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Puchguch_A_W23GB', 'Puchguch_A_W23GB', 'GB', 4, 11, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Puchguch_B_W23GB', 'Puchguch_B_W23GB', 'GB', 4, 11, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Puchguch_C_W23GB', 'Puchguch_C_W23GB', 'GB', 4, 11, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Ghummary_A_W23GB', 'Ghummary_A_W23GB', 'GB', 4, 11, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Ballygond_O_W23GB', 'Ballygond_O_W23GB', 'GB', 4, 11, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('BeenzghaliTirraAkakhel_C_W24KPK', 'BeenzghaliTirraAkakhel_C_W24KPK', 'KPK', 4, 12, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('GhataSarokha_A_W24KPK', 'GhataSarokha_A_W24KPK', 'KPK', 4, 12, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('GhataSarokha_B_W24KPK', 'GhataSarokha_B_W24KPK', 'KPK', 4, 12, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Sugomila_A_W25KPK', 'Sugomila_A_W25KPK', 'KPK', 4, 12, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('SugoMila_B_W25KPK', 'SugoMila_B_W25KPK', 'KPK', 4, 12, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('LandiKotal_A_W26KPK', 'LandiKotal_A_W26KPK', 'KPK', 4, 12, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('LandiKotal_B_W26KPK', 'LandiKotal_B_W26KPK', 'KPK', 4, 12, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('SalehKorBando_O_W26KPK', 'SalehKorBando_O_W26KPK', 'KPK', 4, 12, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Pushtakhararingroad_O_W26KPK', 'Pushtakhararingroad_O_W26KPK', 'KPK', 4, 12, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Tanimomund_O_W24KPK', 'Tanimomund_O_W24KPK', 'KPK', 4, 12, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('MergatKhelZawa_A_W24KPK', 'MergatKhelZawa_A_W24KPK', 'KPK', 4, 12, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('MergatKhelZawa_B_W24KPK', 'MergatKhelZawa_B_W24KPK', 'KPK', 4, 12, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('ShalobarQamberKhel_A_W24KPK', 'ShalobarQamberKhel_A_W24KPK', 'KPK', 4, 12, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('ShalobarQamberKhel_B_W24KPK', 'ShalobarQamberKhel_B_W24KPK', 'KPK', 4, 12, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('BeenzghaliTirraAkakhel_A_W24KPK', 'BeenzghaliTirraAkakhel_A_W24KPK', 'KPK', 4, 13, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('MergatKhelZawa_C_W24KPK', 'MergatKhelZawa_C_W24KPK', 'KPK', 4, 13, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Babro_C_W24KPK', 'Babro_C_W24KPK', 'KPK', 4, 13, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Babro_B_W24KPK', 'Babro_B_W24KPK', 'KPK', 4, 13, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Fazalabad_O_W24KPK', 'Fazalabad_O_W24KPK', 'KPK', 4, 13, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('ShatkhelMandai_O_W23KPK', 'ShatkhelMandai_O_W23KPK', 'KPK', 4, 13, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Qalat_B_W25KPK', 'Qalat_B_W25KPK', 'KPK', 4, 13, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Qalat_C_W25KPK', 'Qalat_C_W25KPK', 'KPK', 4, 13, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Qalat_A_W25KPK', 'Qalat_A_W25KPK', 'KPK', 4, 13, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Topi_O_W26KPK', 'Topi_O_W26KPK', 'KPK', 4, 13, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('LuckyMarwat_O_W26KPK', 'LuckyMarwat_O_W26KPK', 'KPK', 4, 13, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Shakas_O_W26KPK', 'Shakas_O_W26KPK', 'KPK', 4, 13, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Rashidabad_O_W26KPK', 'Rashidabad_O_W26KPK', 'KPK', 4, 13, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Peshawer_O_W23KPK', 'Peshawer_O_W23KPK', 'KPK', 4, 13, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Garbong_O_W24GB', 'Garbong_O_W24GB', 'GB', 6, 14, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Darel_A_W24GB', 'Darel_A_W24GB', 'GB', 6, 14, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('AkhonColony_A_W24GB', 'AkhonColony_A_W24GB', 'GB', 6, 14, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('AkhonColony_B_W24GB', 'AkhonColony_B_W24GB', 'GB', 6, 14, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Lati_A_W24GB', 'Lati_A_W24GB', 'GB', 6, 14, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Lati_B_W24GB', 'Lati_B_W24GB', 'GB', 6, 14, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Hargisa_A_W26GB', 'Hargisa_A_W26GB', 'GB', 6, 14, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Hargisa_B_W26GB', 'Hargisa_B_W26GB', 'GB', 6, 14, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('ThalayChundu_O_W26GB', 'ThalayChundu_O_W26GB', 'GB', 6, 14, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Darel_O_W26GB', 'Darel_O_W26GB', 'GB', 6, 14, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Batoza_A_W26B', 'Batoza_A_W26B', 'Baluchistan', 6, 15, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Batoza_B_W26B', 'Batoza_B_W26B', 'Baluchistan', 6, 15, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Batozai_C_W26B', 'Batozai_C_W26B', 'Baluchistan', 6, 15, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Chakirkhan jamali_O_W26B', 'Chakirkhan jamali_O_W26B', 'Baluchistan', 6, 15, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Dharabi_A_W26B', 'Dharabi_A_W26B', 'Baluchistan', 6, 15, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Dharabi_B_W26B', 'Dharabi_B_W26B', 'Baluchistan', 6, 15, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('GohtHalanWaryo_O_W26B', 'GohtHalanWaryo_O_W26B', 'Baluchistan', 6, 15, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Killi Sheikh MusaBaba_O_W24B', 'Killi Sheikh MusaBaba_O_W24B', 'Baluchistan', 6, 15, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Gothsanwa chattar_O_W24B', 'Gothsanwa chattar_O_W24B', 'Baluchistan', 6, 15, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Hosri_O_W24B', 'Hosri_O_W24B', 'Baluchistan', 6, 15, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('KiliQasumkhadkucha_O_W26B', 'KiliQasumkhadkucha_O_W26B', 'Baluchistan', 6, 16, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('KiliSheikhan_O_W26B', 'KiliSheikhan_O_W26B', 'Baluchistan', 6, 16, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('KilliKhaliqAbad_O_W26B', 'KilliKhaliqAbad_O_W26B', 'Baluchistan', 6, 16, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Kolpur_A_W26B', 'Kolpur_A_W26B', 'Baluchistan', 6, 16, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Kolpur_B_W26B', 'Kolpur_B_W26B', 'Baluchistan', 6, 16, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('MirDurMuhammadRind_O_W26B', 'MirDurMuhammadRind_O_W26B', 'Baluchistan', 6, 16, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('KilliSharifabad_A_W26B', 'KilliSharifabad_A_W26B', 'Baluchistan', 6, 16, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('KilliSharifabad_B_W26B', 'KilliSharifabad_B_W26B', 'Baluchistan', 6, 16, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('TooraKhula_O_W26B', 'TooraKhula_O_W26B', 'Baluchistan', 6, 16, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Killi Korkai_O_W25B', 'Killi Korkai_O_W25B', 'Baluchistan', 6, 17, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('KasraMirzai_A_W25B', 'KasraMirzai_A_W25B', 'Baluchistan', 6, 17, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('KasraMirzai_B_W25B', 'KasraMirzai_B_W25B', 'Baluchistan', 6, 17, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Baghao_O_W24B', 'Baghao_O_W24B', 'Baluchistan', 6, 17, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('GohtKundi_O_W24B', 'GohtKundi_O_W24B', 'Baluchistan', 6, 17, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('KilliBahotBazarJanubi_O_W24B', 'KilliBahotBazarJanubi_O_W24B', 'Baluchistan', 6, 17, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('KilliFarooqabad_A_W24B', 'KilliFarooqabad_A_W24B', 'Baluchistan', 6, 17, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('KilliFarooqabad_B_W24B', 'KilliFarooqabad_B_W24B', 'Baluchistan', 6, 17, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('KilliSurkhanBakhtiyarKhan_A_W24B', 'KilliSurkhanBakhtiyarKhan_A_W24B', 'Baluchistan', 6, 17, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('KilliSurkhanBakhtiyarKhan_B_W24B', 'KilliSurkhanBakhtiyarKhan_B_W24B', 'Baluchistan', 6, 17, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('BastiTambli_O_W24B', 'BastiTambli_O_W24B', 'Baluchistan', 6, 18, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('KilliHajiKhalifaMuhammadHayat_O_W23B', 'KilliHajiKhalifaMuhammadHayat_O_W23B', 'Baluchistan', 6, 18, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Khairava_A_W25B', 'Khairava_A_W25B', 'Baluchistan', 6, 18, '') ON CONFLICT DO NOTHING;
INSERT INTO schools (name, identifier, region, regional_coordinator_id, school_coordinator_id, teacher_phone) VALUES ('Khairava_B_W25B', 'Khairava_B_W25B', 'Baluchistan', 6, 18, '') ON CONFLICT DO NOTHING;
