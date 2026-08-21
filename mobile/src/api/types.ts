export interface CloudUser {
  id: number;
  provider: "guest" | "nickname" | "google" | "email";
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
  membershipTier: "basic" | "pro";
  emailVerifiedAt: string | null;
  isAdmin: boolean;
  arenaRating: number;
  arenaMatchesPlayed: number;
  arenaWins: number;
  arenaLosses: number;
}

export interface PlayerStats {
  gamesStarted: number;
  wins: number;
  losses: number;
  restarts: number;
  hintsUsed: number;
  totalPlaySeconds: number;
}

export interface CloudProgress {
  completedLevels: number[];
  bestTimes: Record<number, number>;
  playerStats: PlayerStats;
  lastLevel: number;
  recentPuzzleFingerprints: string[];
  updatedAt: string | null;
}

export const EMPTY_PLAYER_STATS: PlayerStats = {
  gamesStarted: 0,
  wins: 0,
  losses: 0,
  restarts: 0,
  hintsUsed: 0,
  totalPlaySeconds: 0,
};
