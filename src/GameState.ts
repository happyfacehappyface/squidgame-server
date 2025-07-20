// 게임 전체 상태
export enum GameState {
    WAITING,        // 게임 시작 전 대기
    BOOTING,        // 게임 시작 준비 중
    IN_PROGRESS,    // 게임 진행 중
    FINISHED        // 게임 종료
}

// 게임 페이즈 (게임 진행 중의 세부 단계)
export enum GamePhase {
    REST,           // 휴식 시간 (3초)
    PREPARE,        // 미니게임 준비 중 (플레이어 준비 대기)
    MINIGAME,       // 미니게임 진행 중
    RESULT          // 미니게임 결과 처리 중
}

// 미니게임 타입
export enum MiniGameType {
    DALGONA = "DALGONA",
    TUG_OF_WAR = "TUG_OF_WAR"
}

// 플레이어 상태
export enum PlayerStatus {
    ALIVE,          // 생존
    ELIMINATED      // 탈락
} 