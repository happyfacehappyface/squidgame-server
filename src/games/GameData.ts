
export interface CurrentGameData {
    gameType: string | null;
    data: any;
}


export interface BaseMiniGameData {
    id: number;
}

export interface WaitingGameData extends BaseMiniGameData {
    id: 0;
}

// 팩토리 함수들로 각 게임 데이터 생성
export function createWaitingGameData(): WaitingGameData {
    return { id: 0 };
}

export function createDalgonaGameData(playerCount: number): DalgonaGameData {
    return {
        id: 1,
        isFinished: new Array(playerCount).fill(false),
        isSuccess: new Array(playerCount).fill(false)
    };
}

export function createTugOfWarGameData(): TugOfWarGameData {
    return {
        id: 2,
        leftTeamPlayerIndex: [],
        rightTeamPlayerIndex: [],
        leftTeamScore: 0,
        rightTeamScore: 0
    };
}

export interface DalgonaGameData extends BaseMiniGameData {
    id: 1;
    isFinished: Array<boolean>;
    isSuccess: Array<boolean>;
}

export interface TugOfWarGameData extends BaseMiniGameData {
    id: 2;
    leftTeamPlayerIndex: Array<number>;
    rightTeamPlayerIndex: Array<number>;
    leftTeamScore: number;
    rightTeamScore: number;
}

export type MiniGameData = WaitingGameData | DalgonaGameData | TugOfWarGameData;

export class GameData {
    public totalPlayers: number;
    public playerAlive: Array<boolean>;
    
    public currentMiniGameData: MiniGameData;

    constructor(totalPlayers: number) {
        this.totalPlayers = totalPlayers;
        this.playerAlive = new Array(totalPlayers).fill(true);
        this.currentMiniGameData = createWaitingGameData();
    }

    public getAlivePlayerCount(): number {
        return this.playerAlive.filter(isAlive => isAlive).length;
    }

    // 게임 타입별로 데이터 전환하는 메소드들
    public startDalgonaGame(): void {
        this.currentMiniGameData = createDalgonaGameData(this.totalPlayers);
    }

    public startTugOfWarGame(): void {
        this.currentMiniGameData = createTugOfWarGameData();
    }

    public resetToWaiting(): void {
        this.currentMiniGameData = createWaitingGameData();
    }

    // 현재 게임 타입 확인 메소드들
    public isWaiting(): boolean {
        return this.currentMiniGameData.id === 0;
    }

    public isDalgonaGame(): boolean {
        return this.currentMiniGameData.id === 1;
    }

    public isTugOfWarGame(): boolean {
        return this.currentMiniGameData.id === 2;
    }



} 