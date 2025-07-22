
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
    public gamePlayerIndices: Map<string, number>; // 게임 시작 시점의 고정된 playerIndex

    constructor(roomId: string, maxPlayers: number = 10) {
        this.id = roomId;
        this.clients = new Map<string, Client>();
        this.maxPlayers = maxPlayers;
        this.createdAt = Date.now();
        this.status = RoomStatus.WAITING;
        this.gameStartTime = null;
        this.readyClients = new Set<string>();
        this.gamePlayerIndices = new Map<string, number>();
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

    // 모든 플레이어에게 메시지 브로드캐스트 (성능 최적화)
    public broadcast(message: any, excludeClientId?: string): void {
        const messageStr = JSON.stringify(message);
        let sentCount = 0;
        let failedCount = 0;
        
        this.clients.forEach((client, clientId) => {
            if (clientId !== excludeClientId) {
                try {
                    client.send(message);
                    sentCount++;
                } catch (error) {
                    console.error(`브로드캐스트 실패 - 클라이언트 ${clientId}:`, error);
                    failedCount++;
                }
            }
        });
        
        // 브로드캐스트 결과 로깅 (10명 이상일 때만)
        if (this.clients.size >= 10) {
            console.log(`브로드캐스트 완료: ${sentCount}명 전송 성공, ${failedCount}명 실패 (총 ${this.clients.size}명)`);
        }
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
        
        // 게임 시작 시점의 playerIndex를 고정
        this.fixGamePlayerIndices();
        
        console.log(`방 ${this.id}: 게임 시작`);
    }

    // 게임 종료
    public endGame(): void {
        this.status = RoomStatus.WAITING;
        this.readyClients.clear();
        this.gamePlayerIndices.clear(); // 게임 종료 시 고정 인덱스 초기화
        console.log(`방 ${this.id}: 게임 종료`);
    }

    // 게임 시작 시점의 playerIndex를 고정
    private fixGamePlayerIndices(): void {
        this.gamePlayerIndices.clear();
        const clientIds = Array.from(this.clients.keys());
        clientIds.forEach((clientId, index) => {
            this.gamePlayerIndices.set(clientId, index);
        });
        console.log(`방 ${this.id}: 게임 시작 시점 playerIndex 고정 완료 (${this.gamePlayerIndices.size}명)`);
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

    // 클라이언트의 playerIndex 반환 (게임 중에는 고정된 인덱스 사용)
    public getPlayerIndex(clientId: string): number {
        // 게임이 진행 중이면 고정된 인덱스 사용
        if (this.status === RoomStatus.PLAYING) {
            const fixedIndex = this.gamePlayerIndices.get(clientId);
            if (fixedIndex !== undefined) {
                return fixedIndex;
            }
            // 고정된 인덱스가 없으면 -1 반환 (탈락한 플레이어)
            return -1;
        }
        
        // 게임이 진행 중이 아니면 현재 순서 기준
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