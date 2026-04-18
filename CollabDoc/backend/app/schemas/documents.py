from pydantic import BaseModel, Field


DocumentRole = str


class DocumentCollaboratorRead(BaseModel):
    user_id: str
    username: str
    email: str
    role: str


class ShareLinkRead(BaseModel):
    token: str
    role: str
    created_at: str
    expires_at: str | None
    created_by: str


class DocumentVersionRead(BaseModel):
    version: int
    content: str
    saved_at: str
    saved_by: str


class DocumentRead(BaseModel):
    id: str
    title: str
    content: str
    owner_id: str
    created_at: str
    updated_at: str
    version: int
    collaborators: list[DocumentCollaboratorRead]


class DocumentSummaryRead(BaseModel):
    id: str
    title: str
    owner_id: str
    created_at: str
    updated_at: str
    role: str


class CreateDocumentRequest(BaseModel):
    title: str | None = Field(default="Untitled", max_length=200)


class UpdateDocumentRequest(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    content: str | None = None


class ShareDocumentRequest(BaseModel):
    username_or_email: str
    role: str


class UpdateCollaboratorRequest(BaseModel):
    role: str


class CreateShareLinkRequest(BaseModel):
    role: str
    expires_in_hours: int | None = None


class RedeemShareLinkResponse(BaseModel):
    document: DocumentRead
    role: str
