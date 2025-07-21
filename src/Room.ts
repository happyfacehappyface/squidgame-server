
import { Client } from './Client';

export interface PlayerInfo {
    id: string;
    name: string;
    ip: string;
}

export interface RoomInfo {
    id: string;
    playerCount: number;
    maxPlayers: number;
    status: string;
    createdAt: number;
    gameStartTime: number | null;
    players: PlayerInfo[];
}

export enum RoomStatus {
    WAITING,   // 대기 중 (플레이어 입장/퇴장 가능)
    BOOTING,   // 게임 시작 중 (모든 플레이어의 준비 완료 대기)
    PLAYING    // 게임 진행 중
}

export class Room {
    public readonly id: string;
    public clients: Map<string, Client>;
    public readonly maxPlayers: number;
    public readonly createdAt: number;
    public status: RoomStatus;
    public gameStartTime: number | null;
    public readyClients: Set<string>; // 준비 완료된 클라이언트 ID들

    constructor(roomId: string, maxPlayers: number = 10) {
        this.id = roomId;
        this.clients = new Map<string, Client>();
        this.maxPlayers = maxPlayers;
        this.createdAt = Date.now();
        this.status = RoomStatus.WAITING;
        this.gameStartTime = null;
        this.readyClients = new Set<string>();
    }

    // 플레이어 추가
    public addClient(client: Client, playerName: string): boolean {
        if (this.clients.size >= this.maxPlayers) {
            return false; // 방이 가득 찼음
        }

        client.joinRoom(this.id, playerName);
        this.clients.set(client.id, client);
        
        console.log(`방 ${this.id}: 플레이어 ${playerName} (${client.id}) 참가`);
        return true;
    }

    // 플레이어 제거
    public removeClient(clientId: string): boolean {
        const client = this.clients.get(clientId);
        if (client) {
            const playerName = client.playerName; // leaveRoom() 호출 전에 playerName 저장
            client.leaveRoom();
            this.clients.delete(clientId);
            console.log(`방 ${this.id}: 플레이어 ${playerName} (${clientId}) 퇴장`);
            return true;
        }
        return false;
    }

    // 모든 플레이어에게 메시지 브로드캐스트
    public broadcast(message: any, excludeClientId?: string): void {
        this.clients.forEach((client, clientId) => {
            if (clientId !== excludeClientId) {
                client.send(message);
            }
        });
    }


    // 방이 비어있는지 확인
    public isEmpty(): boolean {
        return this.clients.size === 0;
    }

    // 방이 가득 찼는지 확인
    public isFull(): boolean {
        return this.clients.size >= this.maxPlayers;
    }

    // 게임 부팅 시작 (BOOTING 상태로 변경)
    public startBooting(): void {
        this.status = RoomStatus.BOOTING;
        this.readyClients.clear(); // 준비 상태 초기화
        console.log(`방 ${this.id}: 게임 부팅 시작 (모든 플레이어 준비 대기)`);
    }

    // 게임 시작 (PLAYING 상태로 변경)
    public startGame(): void {
        this.status = RoomStatus.PLAYING;
        this.gameStartTime = Date.now();
        console.log(`방 ${this.id}: 게임 시작`);
    }

    // 게임 종료
    public endGame(): void {
        this.status = RoomStatus.WAITING;
        this.readyClients.clear();
        console.log(`방 ${this.id}: 게임 종료`);
    }

    // 클라이언트 준비 완료 설정
    public setClientReady(clientId: string): void {
        this.readyClients.add(clientId);
        console.log(`방 ${this.id}: 클라이언트 ${clientId} 준비 완료 (${this.readyClients.size}/${this.clients.size})`);
    }

    // 모든 클라이언트가 준비 완료되었는지 확인
    public areAllClientsReady(): boolean {
        return this.readyClients.size === this.clients.size && this.clients.size > 0;
    }

    // 준비 완료된 클라이언트 수 반환
    public getReadyCount(): number {
        return this.readyClients.size;
    }

    // 클라이언트의 playerIndex 반환 (입장 순서)
    public getPlayerIndex(clientId: string): number {
        const clientIds = Array.from(this.clients.keys());
        return clientIds.indexOf(clientId);
    }

    // 모든 플레이어 이름을 playerIndex 순서로 반환
    public getPlayerNames(): string[] {
        const clientIds = Array.from(this.clients.keys());
        return clientIds.map(id => {
            const client = this.clients.get(id);
            return client?.playerName || 'Unknown';
        });
    }
} 