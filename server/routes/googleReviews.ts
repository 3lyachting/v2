import { Router } from "express";

const router = Router();

const DEFAULT_PLACE_URL =
  "https://www.google.com/maps/search/?api=1&query=Sabine+Sailing+La+Ciotat";

/** Fiche Google Sabine Sailing, relevée le 26 novembre 2026. Pas d’appel API. */
const USER_RATINGS_TOTAL = 48;
const RATING = 5;

const day = (year: number, month: number, date: number) =>
  Math.floor(Date.UTC(year, month - 1, date) / 1000);

const REVIEWS = [
  {
    authorName: "D S",
    rating: 5,
    text: "Traversée de la Ciotat à Gibraltar, semaine incroyable à bord de Sabine, avec un capitaine hyper sympa et professionnel, bateau hyper confort, on a très bien mangé, franchement rien à dire, on part avec plein de souvenirs et on a hâte de revenir ! Merci Victor :)",
    time: day(2026, 10, 23),
  },
  {
    authorName: "Theo De simeis",
    rating: 5,
    text: "Excellente expérience de privatisation du bateau à la journée avec Victor. Il connaît les coins sympas autour de Marseille, et fait en sorte que l’expérience corresponde à nos attentes. Prix corrects, et kiff garanti. Je recommande",
    time: day(2026, 8, 24),
  },
  {
    authorName: "remi benhamou",
    rating: 5,
    text: "Nous avons passé une super semaine avec Victor à la découverte de la Corse du Sud ! Le catamaran est très confortable et spacieux. Nous avons particulièrement adoré nous réveiller chaque matin dans un magnifique mouillage différent, avec des paysages incroyables et des eaux turquoise. Victor nous a fait découvrir de superbes endroits tout au long de la semaine. Une expérience dépaysante, conviviale et inoubliable que nous recommandons sans hésiter ! Merci Victor pour cette belle semaine en Corse.",
    time: day(2026, 8, 18),
  },
  {
    authorName: "benoit poupon",
    rating: 5,
    text: "Nous avons passé une semaine formidable de Bastia à Ajaccio en passant par Capraïa, à bord de Sabine, skippé par Victor. C’était top. Sur 7 nuits : 5 au mouillage forain, une sur bouée à Girolata. Je connais bien la Corse, mais vue de la mer c’est autre chose, surtout avec le grand professionnalisme de Victor, son humour et sa bonne humeur. L’ambiance avec les autres hôtes a été fantastique. Dommage que l’on ne puisse pas mettre plus de 5 !",
    time: day(2026, 8, 2),
  },
  {
    authorName: "Marjorie BONACHERA",
    rating: 5,
    text: "Merci à Victor et Romane de nous avoir permis de passer une excellente semaine entre amis en Corse au départ de la Ciotat à bord du merveilleux Sabine. Criques incroyables, rencontre des raies, dauphins et globicéphales, paysages fantastiques et surtout beaucoup de professionnalisme et de bonne humeur. Je recommande sans hésitation.",
    time: day(2026, 6, 22),
  },
  {
    authorName: "Noëlla D'ANTONI",
    rating: 5,
    text: "Une journée absolument exceptionnelle avec Victor ! Nous avons passé un moment inoubliable en catamaran, aussi bien les adultes que les enfants. Tout était parfaitement organisé et l’ambiance était à la fois détendue, conviviale et très sécurisante. Victor est extrêmement agréable, bienveillant et passionné, et la sécurité est sa priorité. Je recommande cette expérience les yeux fermés.",
    time: day(2026, 6, 18),
  },
  {
    authorName: "jeanfrancois LAMARCHI",
    rating: 5,
    text: "Une semaine exceptionnelle en Corse en juin 2026, au départ de La Ciotat, avec un groupe d’amis. Le bateau est très confortable et l’équipage est aux petits soins. Un grand merci à Victor pour son professionnalisme, et à Romane pour sa cuisine. Mouillages idylliques, dauphins et raies. À refaire sans hésiter.",
    time: day(2026, 6, 14),
  },
  {
    authorName: "Victoria Bataller",
    rating: 5,
    text: "Magnifique catamaran. Avec une équipe au top ! Je recommande vivement.",
    time: day(2026, 5, 28),
  },
  {
    authorName: "Morgane niel",
    rating: 5,
    text: "Magnifique journée ! Merci à Victor pour sa gentillesse. Nous sommes venus pour un EVJF et c’était un 10/10. Je vous le recommande les yeux fermés et je ferai appel à lui si nous sommes de retour à Marseille.",
    time: day(2026, 5, 27),
  },
  {
    authorName: "Florent RIZZATO",
    rating: 5,
    text: "Un super moment sur ce magnifique catamaran rénové récemment par Victor et Léa.",
    time: day(2026, 5, 4),
  },
  {
    authorName: "blondine wocs",
    rating: 5,
    text: "C’était vraiment exceptionnel, très accueillant, chaleureux, discret et sympa. Je recommande vivement.",
    time: day(2026, 5, 2),
  },
  {
    authorName: "caroline osta",
    rating: 5,
    text: "Nous avons passé un moment magique sur le catamaran de Victor et Léa. Ils ont été adorables, professionnels, à l’écoute et patients. Vous avez rendu l’anniversaire de mon compagnon inoubliable. Merci à vous !",
    time: day(2026, 5, 2),
  },
  {
    authorName: "nina",
    rating: 5,
    text: "Une belle balade en mer, le skipper est au top. Une journée au petit oignon.",
    time: day(2026, 4, 23),
  },
  {
    authorName: "Thierry Leydet",
    rating: 5,
    text: "Un capitaine à la hauteur, un hôte attentif, un confort à bord comme à la maison ! Des balades à la voile magiques. Merci Victor !!",
    time: day(2026, 3, 31),
  },
  {
    authorName: "Florence Île le",
    rating: 5,
    text: "Une semaine de rêve sur le Sabine en Corse et Sardaigne ! Victor est un vrai pro expérimenté et très sympa en plus. Le catamaran est spacieux et très bien équipé. Les cabines sont plus que confortables. Je recommande !",
    time: day(2026, 3, 31),
  },
  {
    authorName: "benjamin aburbe",
    rating: 5,
    text: "Merci à Victor pour cette superbe visite de criques magnifiques en Corse avec Sabine Sailing. Un moment magique, une très belle ambiance et des souvenirs incroyables. Je recommande vivement !",
    time: day(2026, 3, 27),
  },
  {
    authorName: "Bernard Blanc",
    rating: 5,
    text: "Une quinzaine de rêve sur Sabine Sailing ! Victor nous a fait découvrir des baies de rêve en Corse et Sardaigne. Victor est un skipper très compétent et rassurant, attentif au bien-être de tous. Le bateau est confortable et très bien équipé. Je recommande sans restriction.",
    time: day(2026, 3, 27),
  },
];

router.get("/", (_req, res) => {
  const placeId = (process.env.GOOGLE_PLACE_ID || "").trim();
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.json({
    placeId,
    name: "Sabine Sailing",
    rating: RATING,
    userRatingsTotal: USER_RATINGS_TOTAL,
    url: placeId
      ? `https://search.google.com/local/reviews?placeid=${encodeURIComponent(placeId)}`
      : DEFAULT_PLACE_URL,
    reviews: REVIEWS,
    source: "google_static",
  });
});

export default router;
