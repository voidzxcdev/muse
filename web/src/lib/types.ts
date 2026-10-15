export interface Track { id: string; title: string; thumbnail?: string; thumb?: string; duration?: number | null; uploader?: string; item_id?: number; liked?: boolean }
export interface Privacy { hidden?: boolean; anon?: boolean; playlists?: boolean; likes?: boolean; badges?: boolean; avatar?: boolean }
export interface User { id: number; username: string; display: string; accent?: string; hue?: number; avatar?: string; handle: string; handle_in?: number; created?: number; privacy?: Privacy }
export interface PubUser { id?: number; display: string; handle: string; hue?: number; avatar?: string; online?: boolean; seen?: number; listening?: string }
export interface Playlist { id: number; name: string; count: number; slug: string; cover?: string; custom_cover?: string; listed?: boolean; clone?: boolean; need?: unknown; can_publish?: boolean }
export interface PlaylistDetail { id: number; name: string; slug: string; handle: string; custom_cover?: string; tracks: Track[] }
export interface Listing { id: number; name: string; slug: string; count: number; likes: number; liked: boolean; cover?: string; custom_cover?: string; created: number; owner: PubUser; mine: boolean }
export interface Notif { id: number; kind: string; title: string; body: string; payload: Record<string, any>; from: PubUser | null; created: number; seen: boolean }
export interface ChatMsg { id: number; mine: boolean; kind: string; body: string; payload: Record<string, any>; created: number; reply: { id: number; kind?: string; body?: string; mine?: boolean } | null; edited: boolean; deleted: boolean; read: boolean; updated: number; reacts: { e?: string; emoji?: string; n?: number; count?: number; mine?: boolean }[]; pending?: boolean }
export interface LyricLine { t: number; text: string }
