/** The seed for a person's face: a seller belongs to their listing, a buyer to their name */
export function avatarSeed(merchant: string, listingId?: string | null, buyer = false): string {
  return buyer || !listingId ? `buyer:${merchant}` : `seller:${listingId}`;
}
