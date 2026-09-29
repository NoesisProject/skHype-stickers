// maunium-stickerpicker - A fast and simple Matrix sticker picker widget.
// Copyright (C) 2020 Tulir Asokan
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
let widgetId = null
const pendingRequests = new Map()
const readyWaiters = new Set()

function notifyReady() {
	for (const resolve of readyWaiters) resolve()
	readyWaiters.clear()
}

window.onmessage = event => {
	if (!window.parent || !event.data) return

	const request = event.data
	if (!request.requestId || !request.widgetId || !request.action) return

	if (request.api === "fromWidget" && request.response) {
		const pending = pendingRequests.get(request.requestId)
		if (!pending) return
		pendingRequests.delete(request.requestId)
		if (request.response.error) {
			pending.reject(new Error(request.response.error.message || "Widget API request failed"))
		} else {
			pending.resolve(request.response)
		}
		return
	}

	if (request.api !== "toWidget") return

	if (widgetId) {
		if (widgetId !== request.widgetId) return
	} else {
		widgetId = request.widgetId
		notifyReady()
	}

	let response
	if (request.action === "visibility") {
		response = {}
	} else if (request.action === "capabilities") {
		response = { capabilities: ["m.sticker", "org.matrix.msc4039.upload_file"] }
	} else {
		response = { error: { message: "Action not supported" } }
	}

	window.parent.postMessage({ ...request, response }, event.origin)
}

export function isReady() {
	return !!widgetId
}

export function waitForReady(timeoutMs = 8000) {
	if (widgetId) return Promise.resolve()

	return new Promise((resolve, reject) => {
		const onReady = () => {
			clearTimeout(timer)
			resolve()
		}
		const timer = setTimeout(() => {
			readyWaiters.delete(onReady)
			reject(new Error("Widget API did not become ready. Run the migration from Element Desktop."))
		}, timeoutMs)
		readyWaiters.add(onReady)
	})
}

function sendWidgetRequest(action, data, timeoutMs = 30000) {
	if (!widgetId) return Promise.reject(new Error("Widget API not ready"))

	const requestId = `skhype-${action}-${Date.now()}-${Math.random().toString(36).slice(2)}`

	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			pendingRequests.delete(requestId)
			reject(new Error(`${action} timed out`))
		}, timeoutMs)

		pendingRequests.set(requestId, {
			resolve: response => {
				clearTimeout(timer)
				resolve(response)
			},
			reject: error => {
				clearTimeout(timer)
				reject(error)
			},
		})

		window.parent.postMessage({
			api: "fromWidget",
			action,
			requestId,
			widgetId,
			data,
		}, "*")
	})
}

export async function uploadFile(file) {
	const response = await sendWidgetRequest("org.matrix.msc4039.upload_file", { file })
	const contentUri = response?.content_uri
	if (!contentUri || !contentUri.startsWith("mxc://")) {
		throw new Error("Element did not return a Matrix content URI")
	}
	return contentUri
}

export function sendSticker(content) {
	const data = {
		content: { ...content },
		name: content.body,
	}
	delete data.content.id

	const widgetData = {
		...data,
		description: content.body,
		file: content.filename ?? `${content.id}.png`,
	}
	delete widgetData.content.filename
	delete widgetData.content["net.maunium.telegram.sticker"]

	window.parent.postMessage({
		api: "fromWidget",
		action: "m.sticker",
		requestId: `sticker-${Date.now()}`,
		widgetId,
		data,
		widgetData,
	}, "*")
}
