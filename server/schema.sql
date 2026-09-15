DROP TABLE IF EXISTS guesses;
DROP TABLE IF EXISTS daily_challenges;
DROP TABLE IF EXISTS landmarks;

CREATE TABLE landmarks (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  photo_url TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL
);

CREATE TABLE daily_challenges (
  id SERIAL PRIMARY KEY,
  landmark_id INTEGER NOT NULL REFERENCES landmarks(id),
  challenge_date DATE UNIQUE NOT NULL
);

CREATE TABLE guesses (
  id SERIAL PRIMARY KEY,
  challenge_id INTEGER NOT NULL REFERENCES daily_challenges(id),
  guess_lat DOUBLE PRECISION NOT NULL,
  guess_lng DOUBLE PRECISION NOT NULL,
  distance_m DOUBLE PRECISION NOT NULL,
  score INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO landmarks (name, photo_url, lat, lng) VALUES
('COS', 'https://lh3.googleusercontent.com/place-photos/AG9NLjC-7Qr_i6VCBgSEE2AXXsSq2LgTxJAFs_bnbRkk7R-LNwHDw_STJNmYUi_WVdIsgsBM-sMaik1U_tW-u_GSHRkVtUvVK1bRiI-sBqJ2Mbq4uCRe9x2SutU5LbP2QNhKTbXyNqmdW3X5O8ZaFA=s4800-w800-h600', 30.3521148, 76.3737197),
('Nava Nalanda Central Library', 'https://lh3.googleusercontent.com/place-photos/AG9NLjB-fn55RlZoT6FA9onwv3muc7mm8La-QrunoXnKw7U3-SGS03ro8ZfSsVvra0tq47icen2MOi_Fi162_yhXCsFhwi40PPtS1Vytb38e_YJFX5ym28kTyAM0S62dO_nsS2wckn6je0U7Q1ylqbw=s4800-w800-h600', 30.3543875, 76.3695781),
('Auditorium', 'https://lh3.googleusercontent.com/place-photos/AG9NLjArq3u8qkJHM2e_xqZvrEQN1XWs3zeexsbG4WVjtstJG36hXQY_Lj2uC-il41sP_pQ-6-BK1eOgYabIW8OQzvRvTTuDevgJceuZIw0eH1AaAvVYgzH-6ySw3Eki2zE-zZPvan2GOJVfkgzbfA=s4800-w800-h600', 30.3519998, 76.3709219),
('Badminton Hall', 'https://lh3.googleusercontent.com/place-photos/AG9NLjDsyETLlnn7zJXng9liRklaLc-Kz5EdtdeYo2isAcMFmUJuxKwk9NehzFW4cHXsnjMTFrRflfQxP5VkpwXCJENSQs9EXSo3NVGeYhzraiIcktmxORoSkxl77w9UVsjj_6OHDsCIIhBY0D3q-g=s4800-w800-h600', 30.3548477, 76.3653140),
('Synthetic Running Track', 'https://lh3.googleusercontent.com/place-photos/AG9NLjCpzewEXMWt2QV3XPoB8M77ON_CB_1WG4yGyYymnoUli0KZl0RB47GiXIWkNai8BY7dUuB_WlDXEPjUbyIRkHfL5RyfFjls4mt1Y9no45c1q7Z6GEGu9iOP8h8pMnR7vYlZYmrWCoUbBsSWwKQ=s4800-w800-h600', 30.3544524, 76.3616997);

INSERT INTO daily_challenges (landmark_id, challenge_date) VALUES
(1, CURRENT_DATE),
(2, CURRENT_DATE + 1),
(3, CURRENT_DATE + 2),
(4, CURRENT_DATE + 3),
(5, CURRENT_DATE + 4);