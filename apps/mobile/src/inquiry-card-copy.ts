import type { Locale } from "./locale";

const en = {
  providerRole: "Property provider",
  providerUnavailable: "Provider details unavailable",
  identityVerified: "Provider identity verified",
  authorityDeclared: "Property authority declared",
  identityNote: "Identity verification is not proof of ownership.",
  authorityNote: "A declaration is not proof of ownership.",
  confirmed: "Confirmed",
  viewing: "Request a viewing",
  message: "Message provider",
  safety: "Meet first. Never send money before seeing a property and checking the details.",
  sample: "Sample provider · Interactive design preview",
  webHandoff: "Continue on Pachi web to sign in and contact this provider. Arrange a viewing from your conversation.",
  contactUnavailable: "Contact is unavailable here because a Pachi web address has not been configured.",
  contactError: "Pachi web could not be opened. Try again.",
};

type InquiryCardCopy = typeof en;

const fr: InquiryCardCopy = {
  providerRole: "Prestataire immobilier",
  providerUnavailable: "Informations du prestataire indisponibles",
  identityVerified: "Identité du prestataire vérifiée",
  authorityDeclared: "Autorité sur le bien déclarée",
  identityNote: "La vérification d’identité ne prouve pas la propriété du bien.",
  authorityNote: "Une déclaration ne prouve pas la propriété du bien.",
  confirmed: "Confirmé le",
  viewing: "Demander une visite",
  message: "Contacter le prestataire",
  safety:
    "Rencontrez le prestataire. N’envoyez jamais d’argent avant d’avoir visité le bien et vérifié les détails.",
  sample: "Prestataire fictif · Aperçu interactif du design",
  webHandoff: "Continuez sur Pachi web pour vous connecter et contacter ce prestataire. Organisez une visite depuis votre conversation.",
  contactUnavailable: "Le contact est indisponible ici : aucune adresse Pachi web n’est configurée.",
  contactError: "Impossible d’ouvrir Pachi web. Réessayez.",
};

export function inquiryCardCopy(locale: Locale): InquiryCardCopy {
  return locale === "fr" ? fr : en;
}
