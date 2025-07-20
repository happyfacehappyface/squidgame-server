import { MiniGameType, PlayerStatus } from '../GameState';

// 미니게임 결과
export interface MiniGameResult {
    gameType: MiniGameType;
    eliminatedPlayers: string[]; // 탈락한 플레이어 ID들
    survivors: string[];         // 생존한 플레이어 ID들
    gameData?: any;              // 게임별 추가 데이터
}

// 미니게임 인터페이스
export interface IMiniGame {
    gameType: MiniGameType;
    isActive: boolean;
    
    // 게임 시작
    start(players: string[]): void;
    
    // 게임 종료
    end(): MiniGameResult;
    
    // 플레이어 액션 처리
    handlePlayerAction(playerId: string, action: any): boolean;
    
    // 게임 상태 가져오기
    getGameState(): any;
}

// 미니게임 추상 기본 클래스
export abstract class BaseMiniGame implements IMiniGame {
    public readonly gameType: MiniGameType;
    public isActive: boolean = false;
    protected players: string[] = [];
    protected playerResults: Map<string, any> = new Map();
    
    constructor(gameType: MiniGameType) {
        this.gameType = gameType;
    }
    
    public start(players: string[]): void {
        this.isActive = true;
        this.players = [...players];
        this.playerResults.clear();
        console.log(`${this.gameType} 시작: ${players.length}명 참여`);
        this.onGameStart();
    }
    
    public end(): MiniGameResult {
        this.isActive = false;
        const result = this.calculateResult();
        console.log(`${this.gameType} 종료: ${result.survivors.length}명 생존, ${result.eliminatedPlayers.length}명 탈락`);
        this.onGameEnd();
        return result;
    }
    
    public abstract handlePlayerAction(playerId: string, action: any): boolean;
    protected abstract onGameStart(): void;
    protected abstract onGameEnd(): void;
    protected abstract calculateResult(): MiniGameResult;
    
    public getGameState(): any {
        return {
            gameType: this.gameType,
            isActive: this.isActive,
            players: this.players,
            playerCount: this.players.length
        };
    }
} 