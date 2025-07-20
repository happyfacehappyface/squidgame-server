import { Room, RoomInfo } from './Room';
import { Client } from './Client';

export class RoomManager {
    public readonly globalRoom: Room;

    constructor() {
        // 전역 Room 하나만 관리
        this.globalRoom = new Room('GLOBAL_ROOM', 30); // 최대 30명
        console.log('전역 룸 생성: GLOBAL_ROOM (최대 30명)');
    }

    // 클라이언트를 전역 룸에 추가
    public addClient(client: Client, playerName: string): boolean {
        const success = this.globalRoom.addClient(client, playerName);
        if (success) {
            console.log(`클라이언트 ${client.id} (${playerName})이 전역 룸에 참가했습니다.`);
        } else {
            console.log(`클라이언트 ${client.id} (${playerName}) 참가 실패: 룸이 가득참`);
        }
        return success;
    }

    // 클라이언트를 전역 룸에서 제거
    public removeClient(clientId: string): boolean {
        const success = this.globalRoom.removeClient(clientId);
        if (success) {
            console.log(`클라이언트 ${clientId}이 전역 룸에서 나갔습니다.`);
        }
        return success;
    }

    // 전역 룸의 모든 클라이언트에게 메시지 브로드캐스트
    public broadcast(message: any, excludeClientId?: string): void {
        this.globalRoom.broadcast(message, excludeClientId);
    }

    // 전역 룸의 플레이어 수
    public getPlayerCount(): number {
        return this.globalRoom.clients.size;
    }

    // 전역 룸이 가득 찼는지 확인
    public isFull(): boolean {
        return this.globalRoom.isFull();
    }

    // 전역 룸이 비어있는지 확인
    public isEmpty(): boolean {
        return this.globalRoom.isEmpty();
    }

    // 특정 클라이언트가 룸에 있는지 확인
    public hasClient(clientId: string): boolean {
        return this.globalRoom.clients.has(clientId);
    }

    // 모든 클라이언트 ID 목록 가져오기
    public getAllClientIds(): string[] {
        return Array.from(this.globalRoom.clients.keys());
    }

    // 모든 클라이언트 객체 목록 가져오기
    public getAllClients(): Client[] {
        return Array.from(this.globalRoom.clients.values());
    }

    // 클라이언트의 playerIndex 반환 (입장 순서)
    public getPlayerIndex(clientId: string): number {
        return this.globalRoom.getPlayerIndex(clientId);
    }

    // 모든 플레이어 이름을 playerIndex 순서로 반환
    public getPlayerNames(): string[] {
        return this.globalRoom.getPlayerNames();
    }

    // 게임 부팅 시작
    public startBooting(): void {
        this.globalRoom.startBooting();
    }

    // 게임 시작 (PLAYING 상태로 변경)
    public startGame(): void {
        this.globalRoom.startGame();
    }

    // 클라이언트 준비 완료 설정
    public setClientReady(clientId: string): void {
        this.globalRoom.setClientReady(clientId);
    }

    // 모든 클라이언트가 준비 완료되었는지 확인
    public areAllClientsReady(): boolean {
        return this.globalRoom.areAllClientsReady();
    }

    // 준비 완료된 클라이언트 수 반환
    public getReadyCount(): number {
        return this.globalRoom.getReadyCount();
    }
} 