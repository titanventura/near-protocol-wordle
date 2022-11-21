import {
	call,
	near,
	NearBindgen,
	NearPromise,
	view,
} from "near-sdk-js"
import { blockTimestamp } from "near-sdk-js/lib/api";
import { Correctness, GameStatus } from "./model"

type WordleID = string
type UserID = string

type WordleChar = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K'
	| 'L' | 'M' | 'N' | 'O' | 'P' | 'Q' | 'R' | 'S' | 'T' | 'U' | 'V' | 'W' | 'X'
	| 'Y' | 'Z'

type GameAttempt = {
	letter: WordleChar,
	correctness: Correctness
}[]


type Game = {
	attempts: GameAttempt[]
	status: GameStatus
	createdAt: string
	updatedAt: string
}

type Games = Record<WordleID, Game>


enum ChallengeStatus {
	PENDING = 0,
	ACCEPTED = 1,
	REJECTED = 2
}

type ChallengeSent = {
	index: string
	toIndex: string
	to: UserID
	stake: string
	wordleId: WordleID
	status: ChallengeStatus
	createdAt: string
}

type ChallengeReceived = {
	index: string
	fromIndex: string
	from: UserID
	stake: string
	wordleId: WordleID
	status: ChallengeStatus
	createdAt: string
}

type UserData = {
	games: Games,
	challenges_received: ChallengeReceived[],
	challenges_sent: ChallengeSent[]
}

@NearBindgen({})
class WordleContract {
	wordles = []
	userData: Record<UserID, UserData> = {}


	private wordleExists(word: string) {
		return this.wordles.includes(word)
	}

	private validWordle(word: string) {
		return /^[A-Z]+$/.test(word) && word.length == 5
	}

	@call({ privateFunction: true })
	addWordle({ wordle }: { wordle: string }): { msg: string, success: boolean } {
		// if (near.attachedDeposit() < POINT_ONE) {
		// 	return { msg: "attach minimum 0.1", success: false }
		// }

		wordle = wordle.toUpperCase()
		if (!this.validWordle(wordle)) {
			return {
				msg: "Wordle does not match requirements",
				success: false
			}
		}

		if (this.wordleExists(wordle)) {
			return { msg: "Wordle exists", success: false }
		}

		this.wordles.push(wordle)
		near.log(`new wordle set ! at ${Date.now()}`)
		return { msg: `wordle ${wordle} set`, success: true }
	}

	@view({})
	existingWordle(): { wordle_id: string | null, game: Game | null } {
		let user = near.predecessorAccountId()

		// Check if user is new
		if (!this.userData.hasOwnProperty(user)) {
			return {
				wordle_id: null,
				game: null
			}
		}

		let gamesPlayedByUser = this.userData[user].games

		let wordleAndGame = Object
			.entries(gamesPlayedByUser)
			.find(([wordleId, game]) => {
				return game.status == GameStatus.IN_PROGRESS
			})

		if (wordleAndGame === undefined) {
			return {
				wordle_id: null,
				game: null
			}
		}
		let [wordleId, game] = wordleAndGame
		return {
			wordle_id: wordleId,
			game
		}
	}

	@view({})
	getGameById({ id }: { id: string }): Game {
		let userid = near.predecessorAccountId()
		if (!this.userData.hasOwnProperty(userid)) {
			return null
		}
		let user = this.userData[userid]
		return user.games[id]
	}

	@view({})
	allWordlesByUser(): Games {
		const user = near.predecessorAccountId()
		const games = this.userData[user].games
		return games
	}

	@call({ payableFunction: true })
	solveNewWordle(): {
		msg: string,
		wordle_id: string | null,
		game: Game | null,
		success: boolean
	} {
		let userID = near.predecessorAccountId()
		// user signing in and requesting wordle for first time
		if (!this.userData.hasOwnProperty(userID)) {
			this.userData[userID] = {
				games: {},
				challenges_received: [],
				challenges_sent: []
			}
		}

		let games = this.userData[userID].games

		// check if the user is solving any wordle currently
		let currentWordle = Object.entries(games).find(([wordleID, game]) => {
			return game.status == GameStatus.IN_PROGRESS
		})
		if (currentWordle != undefined) {
			return {
				msg: "there is a wordle that is being solved",
				wordle_id: currentWordle[0],
				game: currentWordle[1],
				success: true
			}
		}

		let challenges_received = this.userData[userID].challenges_received
		let involvedWordleIDs = new Set([
			...Object.keys(games),
			...Object.keys(challenges_received)
		])

		if (involvedWordleIDs.size == Object.keys(this.wordles).length) {
			return {
				msg: "unable to create game. all wordles solved",
				wordle_id: null,
				game: null,
				success: false
			}
		}

		// try to get a unique wordle that the user hasn't solved
		let randomWordleID = Array.from(Array(this.wordles.length).keys())
			.filter(w => !Array.from(involvedWordleIDs).includes(w.toString()))[0]

		let now = blockTimestamp().toString()
		let game: Game = {
			status: GameStatus.IN_PROGRESS,
			attempts: [],
			createdAt: now,
			updatedAt: now
		}
		games[randomWordleID] = game
		return {
			msg: "new game created",
			wordle_id: randomWordleID.toString(),
			game,
			success: true
		}
	}

	@view({})
	checkIfChallengeEligible({ wordle_id, user_id }: { wordle_id: string, user_id: string }): { eligibile: boolean } {
		let userPlayedGames = this.userData[user_id].games
		return {
			eligibile: !Object.keys(userPlayedGames).includes(wordle_id)
		}
	}

	@call({ payableFunction: true })
	challengeUser({ wordle_id, user_id }: { wordle_id: string, user_id: string }): { msg: string, success: boolean } {

		let selfId = near.predecessorAccountId()

		if (!this.userData.hasOwnProperty(selfId)) {
			return {
				msg: "You should solve wordle to make a challenge",
				success: false
			}
		}

		let self = this.userData[selfId]

		if (!Object.keys(self.games).includes(wordle_id)) {
			return {
				msg: "Only solved wordles are eligible to be raised for challenge",
				success: false
			}
		}

		if (self.challenges_sent.filter(chal => chal.wordleId == wordle_id && chal.to == user_id).length > 0) {
			return {
				msg: "Already challenged the user for same wordle",
				success: false
			}
		}

		if (!this.userData.hasOwnProperty(user_id)) {
			this.userData[user_id] = {
				games: {},
				challenges_received: [],
				challenges_sent: []
			}
		}

		let receiver = this.userData[user_id]

		const stake = near.attachedDeposit().toString()
		const now = blockTimestamp().toString()
		const challengeSent: ChallengeSent = {
			stake,
			to: user_id,
			index: self.challenges_sent.length.toString(),
			toIndex: receiver.challenges_received.length.toString(),
			status: ChallengeStatus.PENDING,
			wordleId: wordle_id,
			createdAt: now
		}
		const challengeReceived: ChallengeReceived = {
			stake,
			fromIndex: challengeSent.index,
			index: challengeSent.toIndex,
			status: ChallengeStatus.PENDING,
			from: selfId,
			wordleId: wordle_id,
			createdAt: now
		}

		self.challenges_sent.push(challengeSent)
		receiver.challenges_received.push(challengeReceived)
		return { msg: "Challenge created", success: true }
	}

	@view({})
	challengesSent(): ChallengeSent[] {
		let curUser = near.predecessorAccountId()
		if (!this.userData.hasOwnProperty(curUser)) {
			return []
		}

		return this.userData[curUser].challenges_sent
	}

	@view({})
	challengesReceived(): ChallengeSent[] {
		let curUser = near.predecessorAccountId()
		if (!this.userData.hasOwnProperty(curUser)) {
			return []
		}

		return this.userData[curUser].challenges_sent
	}

	@call({ payableFunction: true })
	decideChallenge({ received_challenge_index, decision }: {
		received_challenge_index: string,
		decision: ChallengeStatus.ACCEPTED | ChallengeStatus.REJECTED
	}): {
		msg: string,
		success: boolean
	} {
		let user = near.predecessorAccountId()
		let self = this.userData[user]

		let receivedChallenge = self.challenges_received[parseInt(received_challenge_index)]
		let sentChallenge = this.userData[receivedChallenge.from].challenges_sent[parseInt(receivedChallenge.fromIndex)]
		if (decision == ChallengeStatus.ACCEPTED) {
			if (near.attachedDeposit() < BigInt(receivedChallenge.stake)) {
				return {
					msg: "Error. stake is less",
					success: false
				}
			}
		}

		receivedChallenge.status = decision
		sentChallenge.status = decision
		return {
			msg: "Challenge decision recorded",
			success: true
		}
	}

	@call({})
	wordleAttempt({ id, attempt }: { id: string, attempt: string }): { game: Game, msg: string, success: boolean } {
		attempt = attempt.toUpperCase()
		if (
			!this.validWordle(attempt)
		) {
			return {
				game: null,
				success: false,
				msg: "Attempt string is in wrong format"
			}
		}

		let userID = near.predecessorAccountId()
		let userGames = this.userData[userID].games
		if (!userGames.hasOwnProperty(id) || userGames[id].status != GameStatus.IN_PROGRESS) {
			return {
				game: null,
				success: false,
				msg: "Wordle is not being played by user. Either not started or already played."
			}
		}

		let currentGame = userGames[id]
		// check if game already has 5 attempts
		if (currentGame.attempts.length == 5) {
			return {
				game: currentGame,
				success: false,
				msg: "Game already reached max attempts"
			}
		}
		let wordle = this.wordles[id]
		let gameAttempt: GameAttempt = []

		for (let i = 0; i < 5; i++) {
			let correctness = null
			if (wordle[i] == attempt[i]) {
				correctness = Correctness.CORRECT
			} else if (wordle.includes(attempt[i])) {
				correctness = Correctness.WRONG_POSITION
			} else {
				correctness = Correctness.DOES_NOT_EXIST
			}
			gameAttempt.push({
				letter: attempt[i] as WordleChar,
				correctness
			})
		}

		currentGame.attempts.push(gameAttempt)

		if (gameAttempt.every(lc => lc.correctness == Correctness.CORRECT)) {
			currentGame.status = GameStatus.WON


			// TODO: see what to do with the challenge if any
			let challengesReceived = this.userData[userID].challenges_received
			let challengeExists = challengesReceived
				.filter(chal => chal.wordleId == id && chal.status == ChallengeStatus.ACCEPTED)
			if (challengeExists.length > 0) {
				let stake = BigInt(challengeExists[0].stake)
				stake += stake
				NearPromise.new(userID).transfer(stake)
			}
		} else {
			if (currentGame.attempts.length == 5) {
				currentGame.status = GameStatus.LOST

				// TODO: see what to do with the challenge if any
				let challengesReceived = this.userData[userID].challenges_received
				let challengeExists = challengesReceived
					.filter(chal => chal.wordleId == id && chal.status == ChallengeStatus.ACCEPTED)
				if (challengeExists.length > 0) {
					let stake = BigInt(challengeExists[0].stake)
					stake += stake
					NearPromise.new(challengeExists[0].from).transfer(stake)
				}
			}
		}
		currentGame.updatedAt = blockTimestamp().toString()

		return {
			game: currentGame,
			msg: "Attempt registered !",
			success: true
		}
	}

	@call({ privateFunction: true })
	deleteAllData() {
		this.wordles = []
		this.userData = {}
	}

	@call({ privateFunction: true })
	allWordles() {
		return {
			wordles: this.wordles,
			user_data: this.userData
		}
	}
}
