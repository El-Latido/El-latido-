export interface User {
  username: string;
  pin: string;
  isBanned: boolean;
  warnings: number;
}

export interface Message {
  id: string;
  username: string;
  text?: string;
  audioUrl?: string; // Base64 audio string or file path
  timestamp: string;
  isSystem?: boolean;
  systemType?: 'warning' | 'ban' | 'welcome' | 'announcement';
}

export interface AnimeManga {
  id: string;
  type: 'anime' | 'manga';
  title: string;
  japaneseTitle?: string;
  genre: string[];
  episodesOrChapters: string;
  status: 'Emisión' | 'Finalizado' | 'En Pausa';
  synopsis: string;
  score: number;
  imageUrl: string;
  recommendedBy?: string;
}

export interface Track {
  id: string;
  title: string;
  anime: string;
  artist: string;
  audioUrl: string; // fallback audio url
  coverUrl: string;
}
