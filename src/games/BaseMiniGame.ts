import { Client } from '../Client';

// 게임 이벤트 타입들
export interface GameStartEvent {
    type: 'GAME_START';
    gameId: number;
    playerCount: number;
}

export interface GameEndEvent {
    type: 'GAME_END';
    gameId: number;
    survivors: number[];
    eliminated: number[];
}

export interface PlayerActionEvent {
    type: 'PLAYER_ACTION';
    playerId: number;
    action: string;
    data: any;
}

export type GameEvent = GameStartEvent | GameEndEvent | PlayerActionEvent;

// 게임 결과 타입
export interface GameResult {
    isGameEnded: boolean;
    survivors: number[];
    eliminated: number[];
    gameData?: any;
}

// 미니게임 베이스 추상 클래스
export abstract class BaseMiniGame {
    protected gameId: number;
    protected players: number[];
    protected isStarted: boolean = false;
    protected isEnded: boolean = false;

    constructor(gameId: number, players: number[]) {
        this.gameId = gameId;
        this.players = [...players]; // 복사본 생성
    }

    // 추상 메소드들 - 각 게임에서 구현해야 함
    abstract start(): Promise<void>;
    abstract stop(): Promise<void>;
    abstract handlePlayerAction(playerId: number, action: string, data: any): Promise<GameResult>;
    abstract getGameData(): any;
    abstract resetGame(): void;

    // 공통 메소드들
    public getGameId(): number {
        return this.gameId;
    }

    public getPlayers(): number[] {
        return [...this.players];
    }

    public isGameStarted(): boolean {
        return this.isStarted;
    }

    public isGameEnded(): boolean {
        return this.isEnded;
    }

    protected markGameStarted(): void {
        this.isStarted = true;
        this.isEnded = false;
    }

    protected markGameEnded(): void {
        this.isEnded = true;
    }

    // 모든 플레이어에게 메시지 브로드캐스트
    protected abstract broadcastToPlayers(message: any): void;

    // 특정 플레이어에게 메시지 전송
    protected abstract sendToPlayer(playerId: number, message: any): void;
} 